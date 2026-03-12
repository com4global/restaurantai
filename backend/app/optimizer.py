"""
AI Budget Optimizer — finds the best meal combinations to feed N people
under a given budget.  Uses a greedy / bounded-search approach (inspired by
the Knapsack Problem) to keep runtime fast even with large menus.
"""
from __future__ import annotations

import re
from typing import NamedTuple

from sqlalchemy.orm import Session

from . import crud, sarvam_service
from .models import MenuItem, MenuCategory, Restaurant


# ---------------------------------------------------------------------------
# 1. Portion-size estimator
# ---------------------------------------------------------------------------

# Keyword → estimated portion_people mapping
_PORTION_HINTS: list[tuple[re.Pattern, int]] = [
    (re.compile(r"biryani|pulao|fried\s*rice|rice\s*bowl", re.I), 2),
    (re.compile(r"pizza.*large|family", re.I), 4),
    (re.compile(r"pizza.*medium", re.I), 3),
    (re.compile(r"pizza.*small|personal", re.I), 1),
    (re.compile(r"pizza", re.I), 2),
    (re.compile(r"curry|gravy|dal|paneer|masala|korma|tikka\s*masala", re.I), 2),
    (re.compile(r"naan|roti|bread|paratha|kulcha|chapati", re.I), 1),
    (re.compile(r"thali|combo|platter|meal", re.I), 1),
    (re.compile(r"soup|salad|appetizer|starter|snack|chaat|fries", re.I), 1),
    (re.compile(r"burger|sandwich|wrap|roll|taco", re.I), 1),
    (re.compile(r"pasta|noodle|chow\s*mein|lo\s*mein|hakka", re.I), 2),
    (re.compile(r"drink|beverage|juice|lassi|chai|coffee|tea|soda|water", re.I), 1),
    (re.compile(r"dessert|ice\s*cream|gulab|sweet|cake|brownie", re.I), 1),
    (re.compile(r"wings|nuggets|momo|dumpling|dim\s*sum", re.I), 2),
]


def estimate_portion_people(item_name: str, price_cents: int) -> int:
    """
    Estimate how many people a menu item can feed.
    Uses keyword heuristics first, then price-based estimation.
    """
    for pattern, portion in _PORTION_HINTS:
        if pattern.search(item_name):
            return portion

    # Price-based fallback: expensive items generally feed more people
    price_dollars = price_cents / 100
    if price_dollars >= 25:
        return 3
    elif price_dollars >= 14:
        return 2
    return 1


def _get_portion(item: MenuItem) -> int:
    """Get portion_people for an item, estimating if not set."""
    if item.portion_people and item.portion_people > 0:
        return item.portion_people
    return estimate_portion_people(item.name, item.price_cents)


# ---------------------------------------------------------------------------
# 2. Scoring
# ---------------------------------------------------------------------------

class ScoredCombo(NamedTuple):
    items: list[tuple[MenuItem, int]]   # (item, quantity)
    total_cents: int
    feeds_people: int
    score: float
    restaurant: Restaurant


def _score_combo(
    items: list[tuple[MenuItem, int]],
    people_required: int,
    budget_cents: int,
    restaurant_rating: float | None = None,
) -> float:
    """
    Score a meal combo.  Higher is better.

    Factors:
    - Meets people requirement (big bonus)
    - Unique dishes (variety bonus)
    - Price efficiency (lower cost-per-person = better)
    - Restaurant rating
    - Penalty for over-feeding (waste)
    - Food quality: penalize drink/water-only combos, reward real food
    """
    total_cents = sum(item.price_cents * qty for item, qty in items)
    people_served = sum(_get_portion(item) * qty for item, qty in items)
    unique_dishes = len(set(item.id for item, _ in items))

    # Base: does it feed enough?
    if people_served < people_required:
        return -1  # invalid — doesn't meet requirement

    score = 0.0

    # Requirement met bonus
    score += 20

    # Variety bonus: more unique dishes = better (strong incentive)
    score += unique_dishes * 5

    # Price efficiency: cost per person served
    cost_per_person = total_cents / max(people_served, 1)
    # Lower cost per person → higher score (normalize to ~0-10 range)
    efficiency = max(0, 10 - (cost_per_person / 100))  # $1/person = 9, $10/person = 0
    score += efficiency

    # Budget utilization — slight bonus for using more of the budget
    utilization = total_cents / budget_cents
    if utilization >= 0.7:
        score += 3  # good use of budget
    elif utilization < 0.3:
        score -= 3  # too cheap, probably not real food

    # Rating bonus
    if restaurant_rating and restaurant_rating > 0:
        score += restaurant_rating * 1.5  # 5-star = +7.5

    # Over-feeding penalty
    overfeed = people_served - people_required
    if overfeed > people_required * 0.5:
        score -= overfeed * 0.5

    # --- Food quality scoring ---
    _DRINK_RE = re.compile(r"water|soda|cola|sprite|juice|drink|beverage|tea\b|coffee|lassi", re.I)
    _SIDE_RE = re.compile(r"\bpav\b|bread|naan|roti|chapati|extra\b|add.?on|dip|sauce|chutney", re.I)
    _REAL_FOOD_RE = re.compile(
        r"biryani|curry|chicken|paneer|pizza|burger|pasta|rice|thali|combo|platter|"
        r"meal|steak|fish|shrimp|lamb|mutton|kebab|tikka|wrap|sandwich|taco|burrito|"
        r"noodle|fried|grilled|roasted|dal|masala|wings|momo", re.I
    )

    total_items = sum(qty for _, qty in items)
    drink_count = sum(qty for item, qty in items if _DRINK_RE.search(item.name))
    side_count = sum(qty for item, qty in items if _SIDE_RE.search(item.name))
    food_count = sum(qty for item, qty in items if _REAL_FOOD_RE.search(item.name))

    # Penalize if more than half the items are drinks/sides
    if drink_count > total_items * 0.5:
        score -= 15  # heavy penalty for drink-dominated combos
    if side_count > total_items * 0.5:
        score -= 8

    # Bonus for having real food items
    score += min(food_count, 5) * 2  # up to +10 for real food

    # Bonus for items that cost >= $5 (they're likely substantial portions)
    substantial = sum(1 for item, _ in items if item.price_cents >= 500)
    score += min(substantial, 4) * 2  # up to +8 for hearty items

    return round(score, 2)



# ---------------------------------------------------------------------------
# 3. Combination generator (greedy + bounded search)
# ---------------------------------------------------------------------------

def _generate_combos(
    items: list[MenuItem],
    budget_cents: int,
    people_required: int,
    restaurant: Restaurant,
    max_total_items: int = 10,
    max_combos: int = 50,
    max_per_item: int = 2,
) -> list[ScoredCombo]:
    """
    Generate valid meal combinations using a greedy approach with
    bounded enumeration.  Forces variety by capping each item to max_per_item.
    """
    if not items:
        return []

    rating = restaurant.rating

    # Sort items by efficiency: portion_people / price (descending)
    scored_items = []
    for item in items:
        portion = _get_portion(item)
        eff = portion / max(item.price_cents, 1)
        scored_items.append((item, portion, eff))
    scored_items.sort(key=lambda x: x[2], reverse=True)

    valid_combos: list[ScoredCombo] = []

    # Strategy 1: Greedy fill — pick most efficient items first (variety-aware)
    greedy_combo = _greedy_fill(scored_items, budget_cents, people_required, max_total_items, max_per_item)
    if greedy_combo:
        total = sum(item.price_cents * qty for item, qty in greedy_combo)
        people = sum(_get_portion(item) * qty for item, qty in greedy_combo)
        s = _score_combo(greedy_combo, people_required, budget_cents, rating)
        if s > 0:
            valid_combos.append(ScoredCombo(greedy_combo, total, people, s, restaurant))

    # Strategy 2: Try anchoring on each of the top items, fill rest greedily
    top_items = scored_items[:min(10, len(scored_items))]
    for anchor_item, anchor_portion, _ in top_items:
        # Only try qty 1-2 per anchor to force variety
        for qty in range(1, min(max_per_item + 1, 3)):
            remaining_budget = budget_cents - anchor_item.price_cents * qty
            remaining_people = people_required - anchor_portion * qty
            if remaining_budget < 0:
                break
            if remaining_people <= 0:
                combo = [(anchor_item, qty)]
                total = anchor_item.price_cents * qty
                people = anchor_portion * qty
                s = _score_combo(combo, people_required, budget_cents, rating)
                if s > 0:
                    valid_combos.append(ScoredCombo(combo, total, people, s, restaurant))
                continue

            # Fill remaining with greedy from other items
            other_items = [(i, p, e) for i, p, e in scored_items if i.id != anchor_item.id]
            fill = _greedy_fill(other_items, remaining_budget, remaining_people, max_total_items - qty, max_per_item)
            if fill:
                combo = [(anchor_item, qty)] + fill
                total = sum(item.price_cents * q for item, q in combo)
                people = sum(_get_portion(item) * q for item, q in combo)
                s = _score_combo(combo, people_required, budget_cents, rating)
                if s > 0:
                    valid_combos.append(ScoredCombo(combo, total, people, s, restaurant))

            if len(valid_combos) >= max_combos:
                break
        if len(valid_combos) >= max_combos:
            break

    # Deduplicate by item set and sort by score
    seen = set()
    unique_combos = []
    for combo in sorted(valid_combos, key=lambda c: c.score, reverse=True):
        key = tuple(sorted((item.id, qty) for item, qty in combo.items))
        if key not in seen:
            seen.add(key)
            unique_combos.append(combo)

    return unique_combos[:max_combos]


def _greedy_fill(
    scored_items: list[tuple[MenuItem, int, float]],
    budget_cents: int,
    people_required: int,
    max_items: int,
    max_per_item: int = 2,
) -> list[tuple[MenuItem, int]] | None:
    """
    Greedy fill: pick the most efficient items until we feed enough people
    or run out of budget.  Caps each item at max_per_item for variety.
    """
    combo: dict[int, tuple[MenuItem, int]] = {}  # item_id → (item, qty)
    total_cost = 0
    total_people = 0
    total_qty = 0

    for item, portion, _ in scored_items:
        if total_people >= people_required:
            break
        if total_qty >= max_items:
            break

        # Check how many of this item we already have
        existing_qty = combo.get(item.id, (item, 0))[1]
        remaining_allowed = max_per_item - existing_qty
        if remaining_allowed <= 0:
            continue

        # How many of this item can we afford / need?
        affordable = (budget_cents - total_cost) // max(item.price_cents, 1)
        still_need = max(0, people_required - total_people)
        need_qty = max(1, -(-still_need // portion))  # ceiling division
        qty = min(affordable, need_qty, max_items - total_qty, remaining_allowed)

        if qty <= 0:
            continue

        combo[item.id] = (item, existing_qty + qty)
        total_cost += item.price_cents * qty
        total_people += portion * qty
        total_qty += qty

    if total_people < people_required:
        return None  # can't meet requirement within budget

    return list(combo.values())


# ---------------------------------------------------------------------------
# 4. LLM explanation
# ---------------------------------------------------------------------------

def _generate_explanation(combo: ScoredCombo, people: int, budget_cents: int) -> str:
    """Generate a human-friendly explanation using Sarvam AI."""
    items_text = "\n".join(
        f"  {qty}x {item.name} (${item.price_cents * qty / 100:.2f})"
        for item, qty in combo.items
    )
    total = f"${combo.total_cents / 100:.2f}"
    budget = f"${budget_cents / 100:.2f}"

    try:
        prompt = (
            f"You are a friendly food recommendation AI. A customer asked to feed "
            f"{people} people under {budget}. Here's the best combo found at "
            f"{combo.restaurant.name}:\n\n{items_text}\n\n"
            f"Total: {total}, Feeds: {combo.feeds_people} people.\n\n"
            f"Write a short, enthusiastic 2-3 sentence recommendation. "
            f"Be specific about why this combo is great. Do NOT use markdown."
        )
        return sarvam_service.chat_completion(prompt)
    except Exception:
        return (
            f"Great combo at {combo.restaurant.name}! "
            f"This order feeds {combo.feeds_people} people for just {total}."
        )


# ---------------------------------------------------------------------------
# 5. Main entry point
# ---------------------------------------------------------------------------

def optimize_meal(
    db: Session,
    people: int,
    budget_cents: int,
    cuisine: str | None = None,
    restaurant_id: int | None = None,
    top_n: int = 5,
) -> list[dict]:
    """
    Find the best meal combos to feed `people` under `budget_cents`.
    Ensures variety across restaurants in the results.

    Returns a list of combo dicts, each with:
      restaurant_name, restaurant_id, items[], total_cents, feeds_people, score
    """
    # Gather restaurants
    if restaurant_id:
        rest = db.query(Restaurant).filter(Restaurant.id == restaurant_id).first()
        restaurants = [rest] if rest else []
    else:
        restaurants = crud.list_restaurants(db)

    # Collect combos per restaurant
    combos_by_restaurant: dict[int, list[ScoredCombo]] = {}

    for restaurant in restaurants:
        # Get all menu items for this restaurant
        categories = crud.list_categories(db, restaurant.id)
        items: list[MenuItem] = []
        for cat in categories:
            cat_items = crud.list_items(db, cat.id)
            for item in cat_items:
                # Filter by cuisine if specified
                if cuisine:
                    item_cuisine = item.cuisine or ""
                    if item_cuisine and cuisine.lower() not in item_cuisine.lower():
                        continue
                # Only include affordable items with valid prices
                if item.price_cents <= 0:
                    continue
                if item.price_cents <= budget_cents:
                    items.append(item)

        if not items:
            continue

        combos = _generate_combos(items, budget_cents, people, restaurant)
        if combos:
            combos_by_restaurant[restaurant.id] = combos

    # Round-robin pick from different restaurants to ensure variety
    top_combos: list[ScoredCombo] = []
    seen_restaurants: set[int] = set()

    # First pass: pick the best combo from each restaurant
    all_best = []
    for rid, combos in combos_by_restaurant.items():
        all_best.append(combos[0])  # best combo from this restaurant
    all_best.sort(key=lambda c: c.score, reverse=True)

    for combo in all_best:
        if len(top_combos) >= top_n:
            break
        top_combos.append(combo)
        seen_restaurants.add(combo.restaurant.id)

    # Second pass: fill remaining slots from all combos (sorted by score)
    if len(top_combos) < top_n:
        all_combos: list[ScoredCombo] = []
        for combos in combos_by_restaurant.values():
            all_combos.extend(combos)
        all_combos.sort(key=lambda c: c.score, reverse=True)

        for combo in all_combos:
            if len(top_combos) >= top_n:
                break
            # Skip if already added
            key = (combo.restaurant.id, tuple(sorted((item.id, qty) for item, qty in combo.items)))
            if any(
                (c.restaurant.id, tuple(sorted((item.id, qty) for item, qty in c.items))) == key
                for c in top_combos
            ):
                continue
            top_combos.append(combo)

    # Build response
    results = []
    for combo in top_combos:
        items_list = [
            {
                "item_id": item.id,
                "name": item.name,
                "quantity": qty,
                "price_cents": item.price_cents,
                "portion_people": _get_portion(item),
            }
            for item, qty in combo.items
        ]

        results.append({
            "restaurant_name": combo.restaurant.name,
            "restaurant_id": combo.restaurant.id,
            "items": items_list,
            "total_cents": combo.total_cents,
            "feeds_people": combo.feeds_people,
            "score": combo.score,
        })

    return results

