import json
import logging
import re
from typing import Any, Optional

from . import sarvam_service
from .models import MenuItem, Restaurant, Order

logger = logging.getLogger(__name__)

_ROUTER_SYSTEM_PROMPT = """
You are the central "Voice Ordering Brain" for a restaurant application.
The user speaks directly to you to modify their cart, navigate the app, or ask food questions.
You must analyze their input, their current cart, and the available restaurant context to return a strictly structured JSON action.

Available Actions:
1. ADD_ITEMS: Add specific items from the provided menu to the cart.
2. REMOVE_ITEMS: Remove specific items or clear the entire cart.
3. CHECKOUT: The user wants to place/submit their current order.
4. SWITCH_RESTAURANT: The user wants to change to a different restaurant.
5. VIEW_CART: The user just wants to see their cart.
6. SHOW_MENU: The user wants to see the menu or a specific category.
7. MULTI_ORDER: The user wants to order from multiple restaurants at once (e.g. "I want pizza from dominos and biryani from aroma").
8. MEAL_PLAN: The user is asking for a multi-day meal plan.
9. PRICE_COMPARE: The user wants to find the cheapest option across all restaurants.
10. CHAT: Any other conversational input, questions, or unclear requests.

Respond ONLY with valid JSON matching one of these structures exactly (do not wrap in markdown tags):
{"action": "ADD_ITEMS", "items": [{"item_id": 123, "quantity": 1, "notes": ""}]}
{"action": "REMOVE_ITEMS", "item_ids": [123], "clear_cart": false}
{"action": "CHECKOUT"}
{"action": "SWITCH_RESTAURANT", "restaurant_slug": "desi-district"}
{"action": "VIEW_CART"}
{"action": "SHOW_MENU", "category_id": null}
{"action": "MULTI_ORDER", "query": "pizza from dominos and dosa from aroma"}
{"action": "MEAL_PLAN", "query": "vegetarian meal plan for 3 days"}
{"action": "PRICE_COMPARE", "query": "cheapest biryani"}
{"action": "CHAT", "reply": "I'm sorry, were you asking for food?"}

CRITICAL RULES:
- If the user asks for a food item that is literally on the provided menu context, output ADD_ITEMS. Handle spelling errors gracefully (e.g. "chicken triple five" -> "Chicken 555").
- If the user asks to remove an item that is in their Current Cart context, output REMOVE_ITEMS with the correct item_id.
- If the user says "remove the cart" or "clear order", output REMOVE_ITEMS with clear_cart=true.
- If the user mentions multiple restaurants in one sentence, output MULTI_ORDER.
- If the user asks for the cheapest or best value, output PRICE_COMPARE.
- You must output valid, raw JSON. No markdown backticks.
"""

def extract_unified_intent(
    user_input: str,
    all_restaurants: list[Restaurant],
    current_restaurant: Optional[Restaurant],
    current_menu: list[MenuItem],
    current_cart: list[dict]
) -> dict[str, Any]:
    """
    Passes the application context to the LLM to determine the single best JSON action.
    """
    
    # 1. Build Restaurant Context
    rest_list = "\\n".join([f"- {r.name} (slug: {r.slug})" for r in all_restaurants])
    rest_ctx = f"Available Restaurants:\\n{rest_list}\\n\\nCurrent Context: {'At ' + current_restaurant.name if current_restaurant else 'No restaurant selected.'}"

    # 2. Build Menu Context
    if current_menu:
        menu_list = "\\n".join([f"ID: {m.id} | {m.name} | ${m.price_cents/100:.2f}" for m in current_menu])
        menu_ctx = f"Current Menu at {current_restaurant.name}:\\n{menu_list}"
    else:
        menu_ctx = "Current Menu: (none visible)"

    # 3. Build Cart Context
    if current_cart:
        cart_list = "\\n".join([f"ID: {i['item_id']} | {i['quantity']}x {i['name']}" for i in current_cart])
        cart_ctx = f"User's Current Cart:\\n{cart_list}"
    else:
        cart_ctx = "User's Current Cart: Empty"

    # Assemble full context
    context = f"{rest_ctx}\\n\\n{menu_ctx}\\n\\n{cart_ctx}"
    user_msg = f'User Input: "{user_input}"'

    try:
        raw_response = sarvam_service.chat_completion(user_msg, _ROUTER_SYSTEM_PROMPT, context)
        cleaned = raw_response.strip()
        
        # Find all valid JSON objects containing an "action" key.
        # The one starting latest in the string is usually the final answer after CoT.
        results = []
        for start_match in re.finditer(r'\{', cleaned):
            start_idx = start_match.start()
            for end_match in reversed(list(re.finditer(r'\}', cleaned))):
                end_idx = end_match.end()
                if end_idx <= start_idx:
                    break
                try:
                    candidate = cleaned[start_idx:end_idx]
                    data = json.loads(candidate)
                    if isinstance(data, dict) and "action" in data:
                        results.append((start_idx, data))
                        break # Found the longest valid JSON starting at this {
                except:
                    continue
        
        if results:
            return max(results, key=lambda x: x[0])[1]
            
        return json.loads(cleaned)
    except Exception as e:
        logger.error(f"Failed to parse LLM router response: {e}\\nResponse: {raw_response}")
        # Fallback to chat if everything burns down
        return {"action": "CHAT", "reply": "Sorry, I had trouble understanding that. Could you try again?"}
