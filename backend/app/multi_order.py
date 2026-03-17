"""
Multi-Restaurant Order Engine.

Parses natural language like:
  "1 butter masala from aroma and 2 chicken biryani from desi district"

Into structured JSON via LLM, then fuzzy-matches restaurants + items,
and adds everything to the user's cart.
"""
from __future__ import annotations

import json
import logging
import os
import re

from sqlalchemy.orm import Session

from . import crud, models
from .config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# LLM Prompt for Multi-Order Extraction
# ---------------------------------------------------------------------------

_MULTI_ORDER_SYSTEM_PROMPT = """You are a food ordering AI assistant.

Your job is to extract structured multi-item ordering intent from a user's message.

Return ONLY valid JSON. Do not explain anything.

Schema:
{
  "items": [
    {
      "quantity": number,
      "dish_name": string,
      "restaurant_name": string
    }
  ]
}

Rules:
- Extract ALL items mentioned by the user.
- Each item MUST have a restaurant_name (from "from X" or "at X").
- If quantity is not mentioned, default to 1.
- dish_name should be the food item name only (no restaurant or quantity).
- restaurant_name should be the restaurant name only.
- Handle "and", commas, and multiple items in one sentence.
- Return only JSON.

Examples:

User: 1 butter masala from aroma and 2 chicken biryani from desi district
Output: {"items": [{"quantity": 1, "dish_name": "butter masala", "restaurant_name": "aroma"}, {"quantity": 2, "dish_name": "chicken biryani", "restaurant_name": "desi district"}]}

User: order 3 pizza from dominos, 1 biryani from spice garden
Output: {"items": [{"quantity": 3, "dish_name": "pizza", "restaurant_name": "dominos"}, {"quantity": 1, "dish_name": "biryani", "restaurant_name": "spice garden"}]}

User: i want butter chicken from aroma and samosa from spice garden
Output: {"items": [{"quantity": 1, "dish_name": "butter chicken", "restaurant_name": "aroma"}, {"quantity": 1, "dish_name": "samosa", "restaurant_name": "spice garden"}]}

User: get me 2 naan and 1 dal tadka from spice garden
Output: {"items": [{"quantity": 2, "dish_name": "naan", "restaurant_name": "spice garden"}, {"quantity": 1, "dish_name": "dal tadka", "restaurant_name": "spice garden"}]}

User: i'd like to order 1 margherita pizza from dominos
Output: {"items": [{"quantity": 1, "dish_name": "margherita pizza", "restaurant_name": "dominos"}]}"""


# ---------------------------------------------------------------------------
# LLM Callers
# ---------------------------------------------------------------------------

def _call_openai_multi(text: str) -> dict | None:
    """Call OpenAI API for multi-order extraction."""
    api_key = settings.openai_api_key or os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None
    try:
        import openai
        client = openai.OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": _MULTI_ORDER_SYSTEM_PROMPT},
                {"role": "user", "content": text},
            ],
            temperature=0,
            max_tokens=500,
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content
        if content:
            return json.loads(content)
    except Exception as e:
        logger.warning(f"OpenAI multi-order extraction failed: {e}")
    return None


def _call_sarvam_multi(text: str) -> dict | None:
    """Call Sarvam AI for multi-order extraction."""
    try:
        from . import sarvam_service
        result = sarvam_service.chat_completion(text, _MULTI_ORDER_SYSTEM_PROMPT)
        if result:
            cleaned = re.sub(r'```json\s*', '', result)
            cleaned = re.sub(r'```\s*', '', cleaned).strip()
            return json.loads(cleaned)
    except Exception as e:
        logger.warning(f"Sarvam multi-order extraction failed: {e}")
    return None


def extract_multi_order(text: str) -> list[dict]:
    """
    Extract multi-order items from natural language text.
    Returns list of {quantity, dish_name, restaurant_name}.
    Uses OpenAI primary, Sarvam fallback.
    """
    # Try OpenAI first
    result = _call_openai_multi(text)
    if not result:
        result = _call_sarvam_multi(text)
    if not result:
        # Last resort: try local regex parsing
        return _parse_multi_order_local(text)

    items = result.get("items", [])
    if not items:
        return _parse_multi_order_local(text)

    return items


# ---------------------------------------------------------------------------
# Local regex fallback (no LLM needed)
# ---------------------------------------------------------------------------

def _parse_multi_order_local(text: str) -> list[dict]:
    """
    Regex-based fallback for multi-order parsing.
    Handles patterns like "N item from restaurant and N item from restaurant"
    """
    items = []
    # Split on " and " or ", " to get segments
    # Pattern: (quantity?) (dish) from (restaurant)
    pattern = r'(\d+)?\s*([a-zA-Z][a-zA-Z\s]+?)\s+(?:from|at)\s+([a-zA-Z][a-zA-Z\s]+?)(?:\s*(?:and|,)\s*|$)'

    for match in re.finditer(pattern, text, re.IGNORECASE):
        qty = int(match.group(1)) if match.group(1) else 1
        dish = match.group(2).strip()
        restaurant = match.group(3).strip()

        # Clean up common prefixes from dish
        dish = re.sub(r'^(?:order|get|i\s+want|i\'?d?\s+like|give\s+me)\s+', '', dish, flags=re.IGNORECASE).strip()

        if dish and restaurant:
            items.append({
                "quantity": qty,
                "dish_name": dish,
                "restaurant_name": restaurant,
            })

    return items


# ---------------------------------------------------------------------------
# Fuzzy matching helpers
# ---------------------------------------------------------------------------

def _edit_distance(a: str, b: str) -> int:
    """Simple Levenshtein distance."""
    if len(a) < len(b):
        return _edit_distance(b, a)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a):
        curr = [i + 1]
        for j, cb in enumerate(b):
            curr.append(min(prev[j + 1] + 1, curr[j] + 1, prev[j] + (ca != cb)))
        prev = curr
    return prev[-1]


def _similarity(a: str, b: str) -> float:
    """Normalized similarity (0-1) between two strings."""
    if not a or not b:
        return 0.0
    dist = _edit_distance(a.lower(), b.lower())
    max_len = max(len(a), len(b))
    return 1.0 - (dist / max_len) if max_len > 0 else 0.0


def find_restaurant(query: str, all_restaurants) -> models.Restaurant | None:
    """Fuzzy match a restaurant name. Returns best match or None."""
    query_lower = query.lower().strip()
    if not query_lower:
        return None

    best_match = None
    best_score = 0.0

    for r in all_restaurants:
        name_lower = r.name.lower()
        slug_lower = (r.slug or "").lower()

        # Exact match
        if query_lower == name_lower or query_lower == slug_lower:
            return r

        # Substring match (high confidence)
        if query_lower in name_lower or name_lower in query_lower:
            score = 0.85
        elif query_lower in slug_lower or slug_lower in query_lower:
            score = 0.80
        else:
            # Fuzzy similarity
            score = max(_similarity(query_lower, name_lower),
                        _similarity(query_lower, slug_lower))

        if score > best_score:
            best_score = score
            best_match = r

    return best_match if best_score >= 0.5 else None


def find_menu_item(query: str, restaurant_id: int, db: Session) -> models.MenuItem | None:
    """Fuzzy match a menu item name within a restaurant."""
    query_lower = query.lower().strip()
    if not query_lower:
        return None

    # Get all items for this restaurant
    categories = crud.list_categories(db, restaurant_id)
    all_items = []
    for cat in categories:
        items = crud.list_items(db, cat.id)
        all_items.extend(items)

    if not all_items:
        return None

    best_match = None
    best_score = 0.0

    for item in all_items:
        item_lower = item.name.lower()

        # Exact match
        if query_lower == item_lower:
            return item

        # Substring match
        if query_lower in item_lower or item_lower in query_lower:
            # Prefer tighter substring matches
            score = 0.9 if len(query_lower) > 3 else 0.7
        else:
            # Token-level matching (for "butter masala" matching "Butter Chicken Masala")
            query_words = query_lower.split()
            item_words = item_lower.split()
            matched = sum(1 for qw in query_words
                          if any(qw in iw or iw in qw or _edit_distance(qw, iw) <= 2
                                 for iw in item_words))
            score = matched / len(query_words) if query_words else 0

        if score > best_score:
            best_score = score
            best_match = item

    return best_match if best_score >= 0.5 else None


# ---------------------------------------------------------------------------
# Main entry: process multi-order
# ---------------------------------------------------------------------------

def process_multi_order(
    db: Session,
    user_id: int,
    text: str,
) -> dict:
    """
    Process a multi-restaurant order from natural language.

    Returns:
    {
        "added": [{"quantity": 1, "item_name": "...", "restaurant_name": "...", "price_cents": 100}],
        "not_found": [{"dish_name": "...", "restaurant_name": "...", "reason": "..."}],
        "total_items": 3,
        "total_cents": 1500,
        "summary_text": "Added 1x Butter Masala from aroma, 2x Chicken Biryani from ...",
        "voice_prompt": "Added 3 items to your cart from 2 restaurants."
    }
    """
    # Step 1: Extract items from text via LLM
    extracted = extract_multi_order(text)
    if not extracted:
        return {
            "added": [],
            "not_found": [],
            "total_items": 0,
            "total_cents": 0,
            "summary_text": "I couldn't understand the order. Try: '1 biryani from spice garden and 2 naan from aroma'",
            "voice_prompt": "I couldn't understand the order. Please try again.",
        }

    # Step 2: Get all restaurants
    all_restaurants = crud.list_restaurants(db)

    added = []
    not_found = []

    for item_req in extracted:
        qty = item_req.get("quantity", 1)
        dish_name = item_req.get("dish_name", "")
        restaurant_name = item_req.get("restaurant_name", "")

        # Step 3: Find restaurant
        restaurant = find_restaurant(restaurant_name, all_restaurants)
        if not restaurant:
            not_found.append({
                "dish_name": dish_name,
                "restaurant_name": restaurant_name,
                "reason": f"Restaurant '{restaurant_name}' not found",
            })
            continue

        # Step 4: Find menu item
        menu_item = find_menu_item(dish_name, restaurant.id, db)
        if not menu_item:
            not_found.append({
                "dish_name": dish_name,
                "restaurant_name": restaurant.name,
                "reason": f"'{dish_name}' not found in {restaurant.name}'s menu",
            })
            continue

        # Step 5: Add to cart
        order = crud.get_user_order_for_restaurant(db, user_id, restaurant.id)
        if not order:
            order = crud.create_order(db, user_id, restaurant.id)

        crud.add_order_item(db, order, menu_item, qty)
        crud.recompute_order_total(db, order)

        added.append({
            "quantity": qty,
            "item_name": menu_item.name,
            "item_id": menu_item.id,
            "restaurant_name": restaurant.name,
            "restaurant_id": restaurant.id,
            "price_cents": menu_item.price_cents * qty,
        })

    # Build summary
    total_items = sum(a["quantity"] for a in added)
    total_cents = sum(a["price_cents"] for a in added)
    restaurant_names = list(set(a["restaurant_name"] for a in added))

    if added:
        item_strs = [f"{a['quantity']}x {a['item_name']} from {a['restaurant_name']}" for a in added]
        summary = "✅ Added to cart:\n" + "\n".join(f"  • {s}" for s in item_strs)
        total_str = f"${total_cents / 100:.2f}"
        summary += f"\n\n**Total: {total_str}**"

        if not_found:
            summary += "\n\n⚠️ Not found:\n" + "\n".join(f"  • {nf['reason']}" for nf in not_found)

        summary += "\n\n🛒 Check your cart to review and checkout!"

        voice_parts = [f"{a['quantity']} {a['item_name']}" for a in added]
        voice_prompt = f"Added {', '.join(voice_parts)} to your cart. Total {total_str}. Check your cart to review and checkout."
    else:
        summary = "❌ Couldn't find any of the requested items.\n"
        summary += "\n".join(f"  • {nf['reason']}" for nf in not_found)
        summary += "\n\nTry: '1 biryani from spice garden and 2 naan from aroma'"
        voice_prompt = "Sorry, I couldn't find those items. Please try again."

    return {
        "added": added,
        "not_found": not_found,
        "total_items": total_items,
        "total_cents": total_cents,
        "summary_text": summary,
        "voice_prompt": voice_prompt,
    }
