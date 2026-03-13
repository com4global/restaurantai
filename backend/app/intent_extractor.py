"""
Hybrid Intent Extraction Engine.

Two layers:
  Layer 1 (fast, free): Local regex-based extraction — handles ~80% of queries
  Layer 2 (LLM fallback): OpenAI / Sarvam AI — handles complex/ambiguous queries

Usage:
    intent = extract_intent("feed 5 people Indian food under $50")
    # → FoodIntent(dish_name=None, cuisine="Indian", people_count=5, budget_total=50, ...)
"""
from __future__ import annotations

import json
import os
import re
import asyncio
import logging
from dataclasses import dataclass, asdict, field
from typing import Optional

logger = logging.getLogger(__name__)

# ─── Intent Data Class ──────────────────────────────────────────────────────

@dataclass
class FoodIntent:
    dish_name: Optional[str] = None
    dish_category: Optional[str] = None
    cuisine: Optional[str] = None
    protein_type: Optional[str] = None
    diet_type: Optional[str] = None
    spice_level: Optional[str] = None
    price_max: Optional[float] = None
    budget_total: Optional[float] = None
    people_count: Optional[int] = None
    rating_min: Optional[float] = None
    open_now: Optional[bool] = None
    meal_type: Optional[str] = None
    occasion: Optional[str] = None
    location: Optional[str] = None
    recommendation_mode: Optional[bool] = None

    def to_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v is not None}

    def has_search_criteria(self) -> bool:
        """Returns True if the intent has any criteria to search by."""
        return any([
            self.dish_name, self.cuisine, self.protein_type,
            self.diet_type, self.price_max, self.budget_total,
            self.people_count, self.recommendation_mode,
            self.rating_min, self.spice_level, self.occasion,
        ])


# ─── Stop Words ─────────────────────────────────────────────────────────────

_STOP_WORDS = {
    # articles / pronouns / prepositions
    "i", "im", "me", "my", "we", "us", "you", "your", "he", "she", "they", "them",
    "it", "its", "the", "a", "an", "this", "that", "these", "those",
    "to", "is", "am", "are", "was", "were", "be", "been", "being",
    "at", "in", "on", "for", "of", "by", "with", "from",
    # verbs / auxiliaries
    "want", "need", "get", "find", "buy", "give", "show", "order",
    "can", "could", "would", "should", "do", "does", "did", "dont",
    "have", "has", "had", "will", "shall", "may", "might",
    "feel", "craving", "wanna", "gimme", "gotta", "lemme",
    # adverbs / adjectives / fillers
    "some", "any", "all", "many", "much", "very", "really", "just",
    "please", "pls", "also", "about", "like", "right", "now", "here",
    "good", "great", "best", "top", "rated", "popular", "trending",
    "most", "highly", "quick", "fast", "asap",
    "friendly", "options", "ideas", "dishes", "restaurants", "places",
    "light", "heavy", "filling", "refreshing", "crunchy", "cheesy",
    "sweet", "comfort", "casual",
    # location fillers
    "near", "nearby", "around", "close", "within",
    "town", "area", "downtown", "city",
    # price fillers (extracted separately)
    "cheap", "cheapest", "cheaply", "affordable", "budget",
    "compare", "price", "value", "lowest",
    # food intent (triggers discovery but not dish search)
    "eat", "eating", "food", "hungry", "meal", "meals",
    "dinner", "lunch", "breakfast", "snack", "snacks",
    "suggest", "recommend", "know", "something", "anything", "surprise",
    # group fillers
    "combo", "gathering", "small",
    # misc
    "where", "what", "which", "how",
    "bro", "dude", "man", "yo", "hey", "ppl",
}


# ─── Cuisine Maps ───────────────────────────────────────────────────────────

_CUISINE_MAP = {
    "indian": "Indian", "chinese": "Chinese", "italian": "Italian",
    "thai": "Thai", "mexican": "Mexican", "japanese": "Japanese",
    "korean": "Korean", "mediterranean": "Mediterranean",
    "vietnamese": "Vietnamese", "turkish": "Turkish", "american": "American",
    "french": "French", "greek": "Greek", "spanish": "Spanish",
    "middle eastern": "Middle Eastern", "african": "African",
    "bbq": "BBQ", "southern": "Southern",
}

# ─── Protein Types ──────────────────────────────────────────────────────────

_PROTEIN_MAP = {
    "chicken": "chicken", "beef": "beef", "lamb": "lamb", "pork": "pork",
    "seafood": "seafood", "fish": "fish", "shrimp": "shrimp",
    "salmon": "salmon", "crab": "crab", "steak": "steak",
}

# ─── Diet Types ─────────────────────────────────────────────────────────────

_DIET_MAP = {
    "vegetarian": "vegetarian", "vegan": "vegan", "keto": "keto",
    "gluten free": "gluten-free", "gluten-free": "gluten-free",
    "low carb": "low-carb", "low-carb": "low-carb",
    "dairy free": "dairy-free", "dairy-free": "dairy-free",
    "halal": "halal", "kosher": "kosher",
    "paleo": "paleo", "plant based": "plant-based", "plant-based": "plant-based",
    "healthy": "healthy", "high protein": "high-protein",
}

# ─── Meal Types ─────────────────────────────────────────────────────────────

_MEAL_TYPES = {
    "breakfast": "breakfast", "lunch": "lunch", "dinner": "dinner",
    "snack": "snack", "brunch": "brunch", "dessert": "dessert",
}

# ─── Occasion ───────────────────────────────────────────────────────────────

_OCCASIONS = {
    "date night": "date night", "date": "date night",
    "birthday": "birthday", "party": "party",
    "family": "family dinner", "romantic": "romantic dinner",
    "game night": "game night", "movie night": "movie night",
    "office": "office lunch",
}

# ─── Discovery Keywords ────────────────────────────────────────────────────

_DISCOVERY_KEYWORDS = {
    "don't know", "dont know", "surprise", "recommend", "suggest",
    "what should i eat", "pick something", "anything",
    "ideas", "popular", "trending",
}


# ─── Layer 1: Local Regex Extraction ────────────────────────────────────────

def extract_intent_local(text: str) -> FoodIntent:
    """
    Fast, free regex-based intent extraction.
    Handles most common query patterns without any API call.
    """
    intent = FoodIntent()
    # Strip apostrophes so "I'm" → "im", "don't" → "dont"
    lower = text.lower().strip()
    lower = re.sub(r"[''`]", "", lower)

    # 1. Discovery / recommendation mode
    for kw in _DISCOVERY_KEYWORDS:
        if kw in lower:
            intent.recommendation_mode = True
            break

    # 2. Extract cuisine
    for pattern, cuisine in _CUISINE_MAP.items():
        if re.search(rf'\b{re.escape(pattern)}\b', lower):
            intent.cuisine = cuisine
            break

    # 3. Extract protein type
    for pattern, protein in _PROTEIN_MAP.items():
        if re.search(rf'\b{re.escape(pattern)}\b', lower):
            intent.protein_type = protein
            break

    # 4. Extract diet type
    for pattern, diet in _DIET_MAP.items():
        if pattern in lower:
            intent.diet_type = diet
            break

    # 5. Extract meal type
    for pattern, meal in _MEAL_TYPES.items():
        if re.search(rf'\b{re.escape(pattern)}\b', lower):
            intent.meal_type = meal
            break

    # 6. Extract occasion
    for pattern, occasion in _OCCASIONS.items():
        if pattern in lower:
            intent.occasion = occasion
            break

    # 7. Extract price_max: "under $15", "less than $20", "below 10 bucks"
    price_match = re.search(
        r'(?:under|less\s+than|below|max|maximum|within)\s*\$?\s*(\d+(?:\.\d+)?)',
        lower
    )
    if price_match:
        intent.price_max = float(price_match.group(1))

    # Also: "$15 or less", "10 bucks"
    if not intent.price_max:
        price_match2 = re.search(r'\$(\d+(?:\.\d+)?)', lower)
        if price_match2:
            intent.price_max = float(price_match2.group(1))

    if not intent.price_max:
        bucks_match = re.search(r'(\d+)\s*bucks?', lower)
        if bucks_match:
            intent.price_max = float(bucks_match.group(1))

    # 8. Extract budget_total: "feed 5 people under $50" → budget is $50
    budget_match = re.search(
        r'(?:feed|for)\s+\d+\s+(?:people|person|friends|family).*?(?:under|less\s+than|within)\s*\$?\s*(\d+(?:\.\d+)?)',
        lower
    )
    if budget_match:
        intent.budget_total = float(budget_match.group(1))
        # Don't also set price_max when budget_total is set
        intent.price_max = None

    # 9. Extract people_count: "feed 5 people", "for 4 people", "party of 6"
    people_match = re.search(
        r'(?:feed|for|party\s+(?:of|for))\s+(\d+)\s*(?:people|person|friends|family|guests)?',
        lower
    )
    if people_match:
        intent.people_count = int(people_match.group(1))

    # Also: "family of 5", "group of 4"
    if not intent.people_count:
        family_match = re.search(r'(?:family|group|team)\s+of\s+(\d+)', lower)
        if family_match:
            intent.people_count = int(family_match.group(1))

    # 10. Extract rating_min: "4 star", "top rated", "highly rated"
    rating_match = re.search(r'(\d(?:\.\d)?)\s*star', lower)
    if rating_match:
        intent.rating_min = float(rating_match.group(1))
    elif any(w in lower for w in ["top rated", "highly rated", "best rated", "best"]):
        intent.rating_min = 4.0

    # 11. Open now
    if "open now" in lower or "open right now" in lower or "available now" in lower:
        intent.open_now = True

    # 12. Spice level
    if any(w in lower for w in ["spicy", "spice", "hot"]):
        intent.spice_level = "spicy"
    elif "mild" in lower:
        intent.spice_level = "mild"

    # 13. Extract dish name — strip stop words + extracted entities
    dish = _extract_dish_name(lower, intent)
    if dish and len(dish) >= 2:
        intent.dish_name = dish

    # 14. If no dish_name and no other criteria → recommendation mode
    if not intent.dish_name and not intent.has_search_criteria():
        # Check if the message has any food-intent or descriptor words
        food_intent_words = {"eat", "eating", "food", "hungry", "meal", "dinner",
                             "lunch", "breakfast", "snack", "suggest", "recommend",
                             "sweet", "cheesy", "crunchy", "filling", "refreshing",
                             "comfort", "light", "heavy", "value", "meals",
                             "options", "ideas", "dishes", "restaurants",
                             "best", "good", "great", "popular", "trending"}
        if any(w in lower.split() for w in food_intent_words):
            intent.recommendation_mode = True

    # 15. If only rating_min is set (e.g. "best meal right now") → also recommendation
    if not intent.dish_name and not intent.cuisine and not intent.protein_type \
       and not intent.diet_type and intent.rating_min and not intent.recommendation_mode:
        food_intent_words_2 = {"meal", "meals", "food", "value", "eat", "eating",
                               "best", "restaurants", "options"}
        if any(w in lower.split() for w in food_intent_words_2):
            intent.recommendation_mode = True

    return intent


def _extract_dish_name(lower: str, intent: FoodIntent) -> str:
    """
    Extract the dish name by stripping stop words, extracted entities,
    and common fillers from the input text.
    """
    # Remove extracted entities so they don't pollute dish name
    text = lower
    entities_to_remove = []

    if intent.cuisine:
        entities_to_remove.append(intent.cuisine.lower())
    if intent.protein_type:
        entities_to_remove.append(intent.protein_type)
    if intent.diet_type:
        entities_to_remove.append(intent.diet_type.replace("-", " "))
        entities_to_remove.append(intent.diet_type)
    if intent.meal_type:
        entities_to_remove.append(intent.meal_type)
    if intent.occasion:
        for word in intent.occasion.split():
            entities_to_remove.append(word)

    for entity in entities_to_remove:
        text = re.sub(rf'\b{re.escape(entity)}\b', '', text, flags=re.IGNORECASE)

    # Remove price patterns
    text = re.sub(r'(?:under|less\s+than|below|max|within)\s*\$?\s*\d+(?:\.\d+)?', '', text)
    text = re.sub(r'\$\d+(?:\.\d+)?', '', text)
    text = re.sub(r'\d+\s*bucks?', '', text)

    # Remove people patterns
    text = re.sub(r'(?:feed|for|party\s+of)\s+\d+\s*(?:people|person|friends|family|guests)?', '', text)
    text = re.sub(r'(?:family|group|team)\s+of\s+\d+', '', text)

    # Remove star ratings
    text = re.sub(r'\d+\s*stars?', '', text)

    # Remove time patterns
    text = re.sub(r'(?:ready\s+)?in\s+\d+\s*(?:minutes?|mins?)', '', text)
    text = re.sub(r'(?:within\s+)?\d+\s*(?:miles?|km|kilometers?)', '', text)

    # Remove stop words
    words = text.split()
    meaningful = [w for w in words if w not in _STOP_WORDS and len(w) >= 2]

    # Remove punctuation
    dish = " ".join(meaningful)
    dish = re.sub(r'[?!.,;:\'"]+', '', dish).strip()
    dish = re.sub(r'\s+', ' ', dish).strip()

    return dish


# ─── Layer 2: LLM Extraction (OpenAI + Sarvam fallback) ────────────────────

_SYSTEM_PROMPT = """You are an AI assistant for a food ordering platform.
Your job is to read a user's message and extract structured food ordering intent.
Users may speak casually, use slang, make typos, or ask indirectly.
You must understand the request and convert it into structured JSON.

Return ONLY valid JSON. Do not include explanations.
If a field is not mentioned, set it to null.

Schema:
{
  "dish_name": string | null,
  "cuisine": string | null,
  "protein_type": string | null,
  "diet_type": string | null,
  "spice_level": string | null,
  "price_max": number | null,
  "budget_total": number | null,
  "people_count": number | null,
  "rating_min": number | null,
  "open_now": boolean | null,
  "meal_type": string | null,
  "occasion": string | null,
  "recommendation_mode": boolean | null
}

Rules:
- If the user asks for a specific dish, fill dish_name.
- If the user asks for a cuisine (Indian, Chinese, Mexican), fill cuisine.
- If the user mentions vegetarian, vegan, halal, keto etc., fill diet_type.
- If the user mentions chicken, beef, seafood etc., fill protein_type.
- If the user specifies a price limit like "under $15", fill price_max.
- If the user says "feed 4 people", fill people_count.
- If the user says "under $40 for everyone", fill budget_total.
- If the user asks for recommendations or says "I don't know what to eat", set recommendation_mode = true.
- If the user says "open now", set open_now = true.

Examples:
User: cheap tacos under $10
Output: {"dish_name": "tacos", "price_max": 10}

User: I don't know what to eat
Output: {"recommendation_mode": true}

User: spicy chicken ramen under $15
Output: {"dish_name": "ramen", "cuisine": "Japanese", "protein_type": "chicken", "spice_level": "spicy", "price_max": 15}

User: feed 5 people Indian food under $50
Output: {"cuisine": "Indian", "people_count": 5, "budget_total": 50}

Return ONLY the JSON object."""


def extract_intent_llm(text: str) -> FoodIntent:
    """
    Use LLM (OpenAI primary, Sarvam fallback) to extract structured intent.
    Only called when local extraction isn't confident enough.
    """
    intent_dict = None

    # Try OpenAI first (faster, more accurate)
    openai_key = os.getenv("OPENAI_API_KEY", "")
    if openai_key:
        try:
            intent_dict = _call_openai(text, openai_key)
        except Exception as e:
            logger.warning(f"OpenAI extraction failed: {e}")

    # Fallback to Sarvam AI
    if intent_dict is None:
        sarvam_key = os.getenv("SARVAM_API_KEY", "")
        if sarvam_key:
            try:
                intent_dict = _call_sarvam(text)
            except Exception as e:
                logger.warning(f"Sarvam extraction failed: {e}")

    if intent_dict is None:
        return FoodIntent()

    return _dict_to_intent(intent_dict)


def _call_openai(text: str, api_key: str) -> dict | None:
    """Call OpenAI API for intent extraction."""
    import openai
    client = openai.OpenAI(api_key=api_key)
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": text},
        ],
        temperature=0,
        max_tokens=300,
        response_format={"type": "json_object"},
    )
    content = response.choices[0].message.content
    if content:
        return json.loads(content)
    return None


def _call_sarvam(text: str) -> dict | None:
    """Call Sarvam AI for intent extraction."""
    from . import sarvam_service
    result = sarvam_service.chat_completion(text, _SYSTEM_PROMPT)
    if result:
        # Try to parse JSON from the response
        # Sarvam may wrap JSON in markdown code blocks
        cleaned = re.sub(r'```json\s*', '', result)
        cleaned = re.sub(r'```\s*', '', cleaned).strip()
        return json.loads(cleaned)
    return None


def _dict_to_intent(d: dict) -> FoodIntent:
    """Convert a dict (from LLM JSON) to a FoodIntent dataclass."""
    intent = FoodIntent()
    for key in [
        "dish_name", "dish_category", "cuisine", "protein_type",
        "diet_type", "spice_level", "meal_type", "occasion",
        "location",
    ]:
        val = d.get(key)
        if val and isinstance(val, str):
            setattr(intent, key, val)

    for key in ["price_max", "budget_total", "rating_min"]:
        val = d.get(key)
        if val is not None:
            try:
                setattr(intent, key, float(val))
            except (ValueError, TypeError):
                pass

    val = d.get("people_count")
    if val is not None:
        try:
            intent.people_count = int(val)
        except (ValueError, TypeError):
            pass

    if d.get("open_now"):
        intent.open_now = True
    if d.get("recommendation_mode"):
        intent.recommendation_mode = True

    return intent


# ─── Main Extraction Function ──────────────────────────────────────────────

def extract_intent(text: str, use_llm: bool = True) -> FoodIntent:
    """
    Hybrid intent extraction:
    1. Try local regex extraction first (fast, free)
    2. If local extraction finds a dish_name or recommendation_mode → use it
    3. Otherwise, if the query seems complex, try LLM
    """
    local = extract_intent_local(text)

    # If local extraction found something useful, use it
    if local.dish_name or local.recommendation_mode:
        return local

    # If local found other criteria (cuisine, diet, budget, etc.), use it
    if local.has_search_criteria():
        return local

    # For complex/ambiguous queries, try LLM
    if use_llm and len(text.strip()) > 3:
        try:
            llm_intent = extract_intent_llm(text)
            # Merge: prefer LLM results but keep local results for fields LLM missed
            merged = _merge_intents(local, llm_intent)
            return merged
        except Exception as e:
            logger.warning(f"LLM extraction failed, using local: {e}")

    return local


def _merge_intents(local: FoodIntent, llm: FoodIntent) -> FoodIntent:
    """Merge local and LLM intents, preferring LLM values when available."""
    result = FoodIntent()
    for f in [
        "dish_name", "dish_category", "cuisine", "protein_type",
        "diet_type", "spice_level", "price_max", "budget_total",
        "people_count", "rating_min", "open_now", "meal_type",
        "occasion", "location", "recommendation_mode",
    ]:
        llm_val = getattr(llm, f)
        local_val = getattr(local, f)
        setattr(result, f, llm_val if llm_val is not None else local_val)
    return result
