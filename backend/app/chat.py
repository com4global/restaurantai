"""
Chat engine with natural-language ordering, structured responses,
and voice-prompt support for conversational voice ordering.

Returns dicts with:
  - reply: text message
  - restaurant_id, category_id, order_id: session state
  - categories: list of category dicts (for interactive chips)
  - items: list of item dicts (for interactive cards)
  - voice_prompt: short TTS-friendly follow-up question for voice mode
  - client_action: instruction for the frontend to route to a different system (e.g. MEAL_PLAN)
  - client_query: arguments for the client_action
"""
from __future__ import annotations

import re
from datetime import datetime

from sqlalchemy.orm import Session

from . import crud
from .models import ChatSession, MenuItem, Order
from .llm_router import extract_unified_intent


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _result(reply, restaurant_id=None, category_id=None, order_id=None,
            categories=None, items=None, cart_summary=None, voice_prompt=None,
            client_action=None, client_query=None):
    return {
        "reply": reply,
        "restaurant_id": restaurant_id,
        "category_id": category_id,
        "order_id": order_id,
        "categories": categories,
        "items": items,
        "cart_summary": cart_summary,
        "voice_prompt": voice_prompt,
        "client_action": client_action,
        "client_query": client_query,
    }


def _build_cart_summary_chat(db: Session, user_id: int) -> dict:
    """Build grouped cart summary for chat responses."""
    pending_orders = crud.get_user_pending_orders(db, user_id)
    groups = []
    grand_total = 0
    for order in pending_orders:
        from .models import Restaurant as RestModel
        restaurant = db.query(RestModel).filter(RestModel.id == order.restaurant_id).first()
        items = []
        for oi in order.items:
            mi = db.query(MenuItem).filter(MenuItem.id == oi.menu_item_id).first()
            line_total = oi.price_cents * oi.quantity
            items.append({
                "name": mi.name if mi else f"Item #{oi.menu_item_id}",
                "quantity": oi.quantity,
                "price_cents": oi.price_cents,
                "line_total_cents": line_total,
            })
        if items:
            groups.append({
                "restaurant_id": order.restaurant_id,
                "restaurant_name": restaurant.name if restaurant else "Unknown",
                "order_id": order.id,
                "items": items,
                "subtotal_cents": order.total_cents,
            })
            grand_total += order.total_cents
    return {"restaurants": groups, "grand_total_cents": grand_total}


def _set_session_state(db: Session, session: ChatSession, **updates) -> None:
    for key, value in updates.items():
        setattr(session, key, value)
    session.updated_at = datetime.utcnow()
    db.commit()


def _categories_data(db, restaurant_id):
    """Return categories as structured dicts with item counts."""
    categories = crud.list_categories(db, restaurant_id)
    result = []
    for cat in categories:
        items = crud.list_items(db, cat.id)
        result.append({
            "id": cat.id,
            "name": cat.name,
            "item_count": len(items),
        })
    return result


def _items_data(db, category_id):
    """Return items in a category as structured dicts."""
    items = crud.list_items(db, category_id)
    return [
        {
            "id": item.id,
            "name": item.name,
            "description": item.description or "",
            "price_cents": item.price_cents,
        }
        for item in items
    ]


def _build_voice_category_list(cats):
    """Build a short TTS-friendly list of category names."""
    names = [c["name"] for c in cats[:6]]
    if len(cats) > 6:
        return ", ".join(names) + f", and {len(cats) - 6} more"
    return ", ".join(names)


def _build_voice_item_list(items, limit=4):
    """Build a short TTS-friendly list of item names."""
    names = [it["name"] for it in items[:limit]]
    if len(items) > limit:
        return ", ".join(names) + f", and {len(items) - limit} more"
    return ", ".join(names)


# ---------------------------------------------------------------------------
# Main message processor
# ---------------------------------------------------------------------------

def process_message(db: Session, session: ChatSession, text: str) -> dict:
    cleaned = text.strip()
    
    # 1. Gather Context
    all_rests = crud.list_restaurants(db)
    current_rest = crud.get_restaurant_by_slug_or_id(db, str(session.restaurant_id)) if session.restaurant_id else None
    current_menu = crud.list_all_items(db, session.restaurant_id) if session.restaurant_id else []
    
    pending_orders = crud.get_user_pending_orders(db, session.user_id)
    cart_ctx = []
    for o in pending_orders:
        for oi in o.items:
            mi = db.query(MenuItem).filter(MenuItem.id == oi.menu_item_id).first()
            if mi:
                cart_ctx.append({"item_id": mi.id, "name": mi.name, "quantity": oi.quantity})

    # 2. Fast-path System Commands to avoid LLM tokens / latency
    if cleaned.startswith("category:"):
        try:
            cat_id = int(cleaned.split(":")[1])
            _set_session_state(db, session, category_id=cat_id)
            items = _items_data(db, cat_id)
            # Find category name gently
            from .models import MenuCategory
            cat = db.query(MenuCategory).filter(MenuCategory.id == cat_id).first()
            name = cat.name if cat else "Category"
            return _result(f"Here are the items for {name}.", restaurant_id=session.restaurant_id, category_id=cat_id, items=items, voice_prompt=f"Here is the {name} menu.")
        except Exception:
            pass  # Fall through to LLM if malformed
            
    if cleaned.startswith("add:"):
        try:
            parts = cleaned.split(":")
            item_id = int(parts[1])
            qty = int(parts[2]) if len(parts) > 2 else 1
            if not session.restaurant_id:
                return _result("Please pick a restaurant first!")
            order = crud.get_user_order_for_restaurant(db, session.user_id, session.restaurant_id)
            if not order:
                order = crud.create_order(db, session.user_id, session.restaurant_id)
            crud.attach_order_to_session(db, session, order)
            mi = db.query(MenuItem).filter(MenuItem.id == item_id).first()
            if mi:
                crud.add_order_item(db, order, mi, qty)
                crud.recompute_order_total(db, order)
                cart = _build_cart_summary_chat(db, session.user_id)
                return _result(f"Added {qty}x {mi.name}.", restaurant_id=session.restaurant_id, order_id=order.id, cart_summary=cart)
        except Exception:
            pass  # Fall through

    # 3. Extract structured JSON action from LLM Router
    action_payload = extract_unified_intent(cleaned, all_rests, current_rest, current_menu, cart_ctx)
    action = action_payload.get("action", "CHAT")
    
    # 3. Handle Actions blindly based on JSON
    if action == "ADD_ITEMS":
        if not session.restaurant_id:
            return _result("Please pick a restaurant first!", voice_prompt="Please pick a restaurant first.")
        
        order = crud.get_user_order_for_restaurant(db, session.user_id, session.restaurant_id)
        if not order:
            order = crud.create_order(db, session.user_id, session.restaurant_id)
        crud.attach_order_to_session(db, session, order)

        added_names = []
        for item_req in action_payload.get("items", []):
            mi = db.query(MenuItem).filter(MenuItem.id == item_req.get("item_id")).first()
            if mi:
                qty = item_req.get("quantity", 1)
                crud.add_order_item(db, order, mi, qty)
                added_names.append(f"{qty}x {mi.name}")
        
        if not added_names:
            return _result("I couldn't find those items on the menu.", voice_prompt="I couldn't find those items.")

        crud.recompute_order_total(db, order)
        total = f"${order.total_cents / 100:.2f}"
        reply = f"Added {', '.join(added_names)}.\\nCart total: {total}"
        cart_summary = _build_cart_summary_chat(db, session.user_id)
        
        # Clean up TTS phrasing like "1x Chicken" to "1 Chicken"
        spoken = ", ".join([n.replace('1x ', '').replace('x ', ' ') for n in added_names])
        voice = f"Added {spoken}. Total {total}."
        
        return _result(reply, restaurant_id=session.restaurant_id, order_id=order.id, cart_summary=cart_summary, voice_prompt=voice)

    elif action == "REMOVE_ITEMS":
        if action_payload.get("clear_cart"):
            for order in pending_orders:
                for oi in order.items:
                    db.delete(oi)
                db.delete(order)
            db.commit()
            _set_session_state(db, session, order_id=None)
            return _result("I've cleared your cart.", cart_summary=_build_cart_summary_chat(db, session.user_id), voice_prompt="I've cleared your cart.")
        
        item_ids_to_remove = set(action_payload.get("item_ids", []))
        removed_names = []
        for order in pending_orders:
            for oi in list(order.items):  # use list to iterate safely during deletion
                if oi.menu_item_id in item_ids_to_remove:
                    mi = db.query(MenuItem).filter(MenuItem.id == oi.menu_item_id).first()
                    removed_names.append(mi.name if mi else "item")
                    crud.remove_order_item(db, order, oi.id)
                    
        if not removed_names:
            cart = _build_cart_summary_chat(db, session.user_id)
            return _result("I couldn't find that item in your cart.", voice_prompt="I couldn't find that in your cart.", cart_summary=cart)
            
        cart_summary = _build_cart_summary_chat(db, session.user_id)
        reply = f"Removed {', '.join(removed_names)}."
        return _result(reply, cart_summary=cart_summary, voice_prompt=reply)

    elif action == "CHECKOUT":
        if session.order_id is None:
            return _result("Your cart is empty!", voice_prompt="Your cart is empty.")
        order = crud.get_order(db, session.order_id)
        if not order:
            _set_session_state(db, session, order_id=None)
            return _result("Cart not found.", voice_prompt="Cart not found.")
        order.status = "submitted"
        db.commit()
        total = f"${order.total_cents / 100:.2f}"
        return _result(f"Order submitted! Total: {total}", restaurant_id=session.restaurant_id, order_id=order.id, voice_prompt=f"Your order has been placed! Total is {total}.")

    elif action == "SWITCH_RESTAURANT":
        slug = action_payload.get("restaurant_slug")
        matched = next((r for r in all_rests if r.slug == slug), None)
        if matched:
            _set_session_state(db, session, restaurant_id=matched.id, category_id=None)
            categories = _categories_data(db, matched.id)
            cat_list = _build_voice_category_list(categories)
            prompt = f"Welcome to {matched.name}. We have {cat_list}. What would you like?" if categories else f"Welcome to {matched.name}."
            return _result(f"Switched to **{matched.name}**!", restaurant_id=matched.id, categories=categories, voice_prompt=prompt)
        return _result("I couldn't find that restaurant.", voice_prompt="I couldn't find that restaurant.")

    elif action == "VIEW_CART":
        cart = _build_cart_summary_chat(db, session.user_id)
        if not pending_orders:
            return _result("Your cart is empty!", restaurant_id=session.restaurant_id, voice_prompt="Your cart is empty. What would you like to order?")
        
        # Build nice TTS cart rundown
        item_names = []
        for o in pending_orders:
            for oi in o.items:
                mi = db.query(MenuItem).filter(MenuItem.id == oi.menu_item_id).first()
                if mi:
                    item_names.append(f"{oi.quantity} {mi.name}")
        spoken_cart = ", ".join(item_names[:3])
        if len(item_names) > 3: spoken_cart += " and more"
        return _result("Here's your cart.", restaurant_id=session.restaurant_id, cart_summary=cart, voice_prompt=f"You have {spoken_cart}. Say submit order to checkout.")

    elif action == "SHOW_MENU":
        cats = _categories_data(db, session.restaurant_id) if session.restaurant_id else []
        if active_cat_id := action_payload.get("category_id"):
            mi = _items_data(db, active_cat_id)
            return _result("Here's that category.", restaurant_id=session.restaurant_id, category_id=active_cat_id, items=mi, voice_prompt="Here is the category menu.")
        cat_list = _build_voice_category_list(cats) if cats else "nothing right now"
        return _result("Here are the categories.", restaurant_id=session.restaurant_id, categories=cats, voice_prompt=f"We have these categories: {cat_list}.")

    elif action == "MULTI_ORDER":
        return _result("Routing you to multi-order...", client_action="ROUTE_MULTI_ORDER", client_query=action_payload.get("query"))

    elif action == "MEAL_PLAN":
        return _result("Generating meal plan...", client_action="ROUTE_MEAL_PLAN", client_query=action_payload.get("query"))

    elif action == "PRICE_COMPARE":
        return _result("Searching globally...", client_action="ROUTE_PRICE_COMPARE", client_query=action_payload.get("query"))

    else:
        # Action CHAT or unknown
        reply = action_payload.get("reply", "I didn't quite catch that. What would you like to order?")
        return _result(reply, voice_prompt=reply)
