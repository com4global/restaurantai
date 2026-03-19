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

_MULTI_ORDER_SYSTEM_PROMPT_TEMPLATE = """You are a food ordering AI assistant.

Your job is to extract structured multi-item ordering intent from a user's message.

Return ONLY valid JSON. Do not explain anything.

Schema:
{{
  "items": [
    {{
      "quantity": number,
      "dish_name": string,
      "restaurant_name": string
    }}
  ]
}}

AVAILABLE RESTAURANTS:
{restaurant_list}

Rules:
- Extract ALL items mentioned by the user.
- Each item MUST have a restaurant_name (from "from X" or "at X").
- CRITICAL: The restaurant_name MUST be one of the AVAILABLE RESTAURANTS listed above.
- The user may mispronounce or misspell restaurant names (e.g. "Macy District" = "Desi District", "the sea District" = "Desi District", "aroma" = "aroma"). Always map to the closest matching restaurant from the list.
- If quantity is not mentioned, default to 1.
- dish_name should be the food item name only (no restaurant or quantity).
- Handle "and", commas, and multiple items in one sentence.
- If "some" or other vague quantities are used, default to 1.
- Return only JSON.

Examples:

User: 1 butter masala from aroma and 2 chicken biryani from desi district
Output: {{"items": [{{"quantity": 1, "dish_name": "butter masala", "restaurant_name": "aroma"}}, {{"quantity": 2, "dish_name": "chicken biryani", "restaurant_name": "Desi District"}}]}}

User: i'd like to order some biryani from macy district
Output: {{"items": [{{"quantity": 1, "dish_name": "biryani", "restaurant_name": "Desi District"}}]}}

User: get me 2 naan and 1 dal tadka from spice garden
Output: {{"items": [{{"quantity": 2, "dish_name": "naan", "restaurant_name": "Spice Garden"}}, {{"quantity": 1, "dish_name": "dal tadka", "restaurant_name": "Spice Garden"}}]}}

User: i'd like to order 1 margherita pizza from dominos
Output: {{"items": [{{"quantity": 1, "dish_name": "margherita pizza", "restaurant_name": "dominos"}}]}}"""


def _build_system_prompt(restaurant_names: list[str]) -> str:
    """Build system prompt with available restaurant names."""
    if restaurant_names:
        restaurant_list = "\n".join(f"- {name}" for name in restaurant_names)
    else:
        restaurant_list = "(no restaurants available)"
    return _MULTI_ORDER_SYSTEM_PROMPT_TEMPLATE.format(restaurant_list=restaurant_list)


# ---------------------------------------------------------------------------
# LLM Callers
# ---------------------------------------------------------------------------

def _call_openai_multi(text: str, system_prompt: str) -> dict | None:
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
                {"role": "system", "content": system_prompt},
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


def _call_sarvam_multi(text: str, system_prompt: str) -> dict | None:
    """Call Sarvam AI for multi-order extraction."""
    try:
        from . import sarvam_service
        result = sarvam_service.chat_completion(text, system_prompt)
        if result:
            cleaned = re.sub(r'```json\s*', '', result)
            cleaned = re.sub(r'```\s*', '', cleaned).strip()
            return json.loads(cleaned)
    except Exception as e:
        logger.warning(f"Sarvam multi-order extraction failed: {e}")
    return None


def extract_multi_order(text: str, restaurant_names: list[str] = None) -> list[dict]:
    """
    Extract multi-order items from natural language text.
    Returns list of {quantity, dish_name, restaurant_name}.
    Uses OpenAI primary, Sarvam fallback.
    restaurant_names: list of actual restaurant names for LLM to match against.
    """
    system_prompt = _build_system_prompt(restaurant_names or [])
    # Try OpenAI first
    result = _call_openai_multi(text, system_prompt)
    if not result:
        result = _call_sarvam_multi(text, system_prompt)
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

    # Strip common articles and filler words (voice transcription often adds these)
    query_cleaned = re.sub(r'\b(?:the|a|an|at|in)\b', '', query_lower).strip()
    query_cleaned = re.sub(r'\s+', ' ', query_cleaned)  # collapse whitespace

    logger.info(f"[RESTAURANT MATCH] query='{query_lower}' cleaned='{query_cleaned}'")

    best_match = None
    best_score = 0.0

    for r in all_restaurants:
        name_lower = r.name.lower()
        slug_lower = (r.slug or "").lower()

        # Exact match (original or cleaned)
        if query_lower == name_lower or query_lower == slug_lower:
            logger.info(f"[RESTAURANT MATCH] ✅ exact match: '{r.name}'")
            return r
        if query_cleaned == name_lower or query_cleaned == slug_lower:
            logger.info(f"[RESTAURANT MATCH] ✅ exact match (cleaned): '{r.name}'")
            return r

        # Substring match (high confidence)
        if query_lower in name_lower or name_lower in query_lower:
            score = 0.85
        elif query_cleaned in name_lower or name_lower in query_cleaned:
            score = 0.85
        elif query_lower in slug_lower or slug_lower in query_lower:
            score = 0.80
        elif query_cleaned in slug_lower or slug_lower in query_cleaned:
            score = 0.80
        else:
            # Fuzzy similarity on full string
            full_score = max(_similarity(query_lower, name_lower),
                            _similarity(query_cleaned, name_lower),
                            _similarity(query_lower, slug_lower),
                            _similarity(query_cleaned, slug_lower))

            # Token-level matching (handles "sea District" → "Desi District")
            query_words = query_cleaned.split()
            name_words = name_lower.split()
            if query_words and name_words:
                matched = sum(
                    1 for qw in query_words
                    if any(
                        qw == nw or qw in nw or nw in qw
                        or _edit_distance(qw, nw) <= max(1, len(min(qw, nw, key=len)) // 3)
                        for nw in name_words
                    )
                )
                token_score = matched / max(len(query_words), len(name_words))
            else:
                token_score = 0.0

            score = max(full_score, token_score)

        if score > best_score:
            best_score = score
            best_match = r

    if best_match:
        logger.info(f"[RESTAURANT MATCH] Best: '{best_match.name}' score={best_score:.2f} (threshold=0.45)")
    else:
        logger.info(f"[RESTAURANT MATCH] No match found for '{query_lower}'")

    return best_match if best_score >= 0.45 else None


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
    # Step 1: Get all restaurants (needed for LLM prompt)
    all_restaurants = crud.list_restaurants(db)
    restaurant_names = list(set(r.name for r in all_restaurants))
    logger.info(f"[MULTI-ORDER] Input: '{text}'")
    logger.info(f"[MULTI-ORDER] Available restaurants: {restaurant_names}")

    # Step 2: Extract items from text via LLM (with restaurant list for smart matching)
    extracted = extract_multi_order(text, restaurant_names)
    logger.info(f"[MULTI-ORDER] LLM extracted: {extracted}")
    if not extracted:
        return {
            "added": [],
            "not_found": [],
            "total_items": 0,
            "total_cents": 0,
            "summary_text": "I couldn't understand the order. Try: '1 biryani from spice garden and 2 naan from aroma'",
            "voice_prompt": "I couldn't understand the order. Please try again.",
        }

    added = []
    not_found = []

    for item_req in extracted:
        qty = item_req.get("quantity", 1)
        dish_name = item_req.get("dish_name", "")
        restaurant_name = item_req.get("restaurant_name", "")
        logger.info(f"[MULTI-ORDER] Processing: {qty}x '{dish_name}' from '{restaurant_name}'")

        # Step 3: Find restaurant — LLM already mapped to real name, so exact match first
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

        summary += "\n\n🛒 Would you like anything else, or shall we checkout?"

        voice_parts = [f"{a['quantity']} {a['item_name']}" for a in added]
        voice_prompt = f"Added {', '.join(voice_parts)} to your cart. Total {total_str}. Would you like anything else, or shall we checkout?"
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
