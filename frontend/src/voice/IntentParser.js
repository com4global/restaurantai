/**
 * IntentParser.js — Ultra-fast local intent extraction + routing (<10ms)
 * 
 * Extracts BOTH:
 * 1. Structured entities (dish, protein, price, spice, cuisine, diet)
 * 2. Intent classification (NEW_SEARCH, FILTER_UPDATE, CHANGE_RESTAURANT, etc.)
 * 
 * Used with ConversationState to maintain context across turns.
 */

// ─── Entity databases ───────────────────────────────────────────────
const DISHES = [
    'biryani', 'pizza', 'burger', 'pasta', 'naan', 'curry', 'tikka', 'masala',
    'dosa', 'idli', 'samosa', 'pakora', 'roti', 'paratha', 'paneer', 'dal',
    'rice', 'fried rice', 'noodles', 'momos', 'tandoori', 'kebab', 'wrap',
    'sandwich', 'salad', 'soup', 'steak', 'wings', 'fries', 'tacos', 'burrito',
    'sushi', 'ramen', 'pho', 'pad thai', 'shawarma', 'falafel', 'hummus',
    'chaat', 'pani puri', 'vada pav', 'chole bhature', 'butter chicken',
    'chicken tikka', 'fish curry', 'mutton', 'lamb', 'prawn', 'shrimp',
    'ice cream', 'gulab jamun', 'jalebi', 'kheer', 'cake', 'brownie',
    'lassi', 'chai', 'coffee', 'juice', 'smoothie', 'milkshake', 'tea',
];

const PROTEINS = ['chicken', 'mutton', 'lamb', 'fish', 'prawn', 'shrimp', 'egg', 'paneer', 'tofu', 'beef', 'pork'];
const SPICE_LEVELS = ['extra spicy', 'not spicy', 'less spicy', 'spicy', 'mild', 'medium', 'hot'];
const CUISINES = ['south indian', 'north indian', 'indo-chinese', 'indian', 'chinese', 'italian', 'mexican', 'thai', 'japanese', 'american', 'mediterranean', 'korean', 'mughlai'];
const DIETS = ['vegetarian', 'vegan', 'non-veg', 'non veg', 'halal', 'gluten-free', 'keto', 'low-carb', 'jain', 'veg'];

// ─── Intent types ───────────────────────────────────────────────────
export const INTENTS = {
    NEW_SEARCH: 'NEW_SEARCH',           // "cheap biryani" — fresh food search
    FILTER_UPDATE: 'FILTER_UPDATE',     // "make it veg", "show cheaper", "only 4 star"
    CHANGE_RESTAURANT: 'CHANGE_RESTAURANT', // "change to desi district"
    ADD_TO_CART: 'ADD_TO_CART',         // "add 2 biryani", "order that"
    REMOVE_ITEM: 'REMOVE_ITEM',        // "remove naan"
    CHECKOUT: 'CHECKOUT',              // "place order", "checkout"
    GREETING: 'GREETING',              // "hello", "hi"
    HELP: 'HELP',                      // "what can you do"
    THANKS: 'THANKS',                  // "thanks"
    GOODBYE: 'GOODBYE',               // "bye"
    MEAL_PLAN: 'MEAL_PLAN',            // "plan meals for the week"
    SHOW_CART: 'SHOW_CART',            // "what's in my cart", "show cart"
    MULTI_ORDER: 'MULTI_ORDER',        // "1 biryani from spice garden and 2 naan from aroma"
    UNCLEAR: 'UNCLEAR',               // Can't classify
};

// ─── Intent detection patterns ──────────────────────────────────────

const CHANGE_RESTAURANT_PATTERNS = [
    /^(?:change|switch|move|go)\s+(?:to|the\s+restaurant\s+to)\s+/i,
    /^(?:order|get|eat)\s+(?:from|at)\s+/i,
    /^(?:show|open|select|pick|choose|try|use|browse)\s+/i,
    /(?:from|at|in)\s+(.+?)(?:\s+restaurant|\s+menu)?\s*$/i,
];

const FILTER_UPDATE_PATTERNS = [
    /^(?:make\s+it|only|show|filter|just|change\s+to)\s+(veg|vegetarian|vegan|non-?veg|halal|gluten.?free|spicy|mild|cheap|cheaper|expensive)/i,
    /^(?:show|get|find)\s+(?:me\s+)?(?:only\s+)?(cheaper|spicier|milder|better|higher.?rated|closest|nearest)/i,
    /^(?:under|below|less\s+than|max|budget)\s+\$?\d+/i,
    /^(?:only|at\s+least|minimum)\s+(\d+)\s*(?:star|rating)/i,
    /^(?:sort|order)\s+by\s+(price|rating|distance|popular)/i,
    /^(cheaper|spicier|milder|closer|better|higher.?rated|lowest.?price|highest.?rated)/i,
];

const ADD_TO_CART_PATTERNS = [
    /^(?:add|order|get|i(?:'ll|\s+will)\s+(?:have|take|get)|give\s+me|get\s+me|i\s+want|i\s+need|i'?d\s+like)\b/i,
    /^(?:add)\s+(?:to\s+cart|that|this|it)/i,
    /^(?:order)\s+(?:that|this|it|the)/i,
];

const REMOVE_PATTERNS = [
    /^(?:remove|delete|cancel|take\s+out|drop)\s+/i,
];

const CHECKOUT_PATTERNS = [
    /^(?:checkout|check\s+out|place\s+(?:my\s+)?order|submit|confirm|pay|finish|done|complete)\s*$/i,
    /^(?:i'?m\s+done|that'?s\s+(?:all|it)|nothing\s+else)\s*$/i,
];

const SHOW_CART_PATTERNS = [
    /^(?:show|what'?s?\s+(?:in\s+)?(?:my\s+)?cart|view\s+cart|my\s+cart|my\s+order|cart)\s*$/i,
];

const GREETING_PATTERNS = [
    /^(?:hi|hello|hey|howdy|yo|sup|good\s+(?:morning|afternoon|evening|night)|can\s+you\s+hear\s+me|test(?:ing)?|mic\s+(?:test|check))[\s?!.]*$/i,
];

const HELP_PATTERNS = [
    /^(?:what\s+can\s+you\s+do|how\s+(?:do(?:es)?)\s+(?:this|it)\s+work|help(?:\s+me)?|what\s+(?:is|are)\s+(?:this|you))[\s?!]*$/i,
];

const THANKS_PATTERNS = [
    /^(?:thank(?:s|\s+you)|thanks\s+a\s+lot|appreciate\s+it|thx|ty)[\s?!.]*$/i,
];

const GOODBYE_PATTERNS = [
    /^(?:bye|goodbye|see\s+you|later|good\s+night|gotta\s+go|exit|quit|stop|end)[\s?!.]*$/i,
];

const MEAL_PLAN_PATTERNS = [
    /(?:plan|create|make|generate|build)\s+(?:my\s+|a\s+)?(?:meal|food|dinner|lunch)s?\s*(?:plan)?/i,
    /meal\s*plan/i,
    /(?:weekly|daily|\d+\s*day)\s+(?:meal|food)\s*plan/i,
];

/**
 * Parse user utterance and classify intent (<10ms)
 * @param {string} text - Raw user text
 * @param {object} convState - Current conversation state
 * @param {Array} restaurants - Available restaurants for matching
 * @returns {{ intent, entities, restaurantMatch, raw, parseTimeMs }}
 */
export function parseIntent(text, convState = {}, restaurants = []) {
    const t = text.toLowerCase().trim();
    const start = performance.now();

    const result = {
        intent: INTENTS.UNCLEAR,
        entities: {},    // Extracted entities (dish, protein, price, etc.)
        stateUpdate: {}, // Fields to update in conversation state
        restaurantMatch: null, // Matched restaurant object
        raw: text,
        parseTimeMs: 0,
    };

    // ─── 1. Greeting/Help/Thanks/Goodbye (fast exit) ─────────────
    if (GREETING_PATTERNS.some(p => p.test(t))) {
        result.intent = INTENTS.GREETING;
        result.parseTimeMs = performance.now() - start;
        return result;
    }
    if (HELP_PATTERNS.some(p => p.test(t))) {
        result.intent = INTENTS.HELP;
        result.parseTimeMs = performance.now() - start;
        return result;
    }
    if (THANKS_PATTERNS.some(p => p.test(t))) {
        result.intent = INTENTS.THANKS;
        result.parseTimeMs = performance.now() - start;
        return result;
    }
    if (GOODBYE_PATTERNS.some(p => p.test(t))) {
        result.intent = INTENTS.GOODBYE;
        result.parseTimeMs = performance.now() - start;
        return result;
    }

    // ─── 2. Checkout ─────────────────────────────────────────────
    if (CHECKOUT_PATTERNS.some(p => p.test(t))) {
        result.intent = INTENTS.CHECKOUT;
        result.parseTimeMs = performance.now() - start;
        return result;
    }

    // ─── 3. Show cart ────────────────────────────────────────────
    if (SHOW_CART_PATTERNS.some(p => p.test(t))) {
        result.intent = INTENTS.SHOW_CART;
        result.parseTimeMs = performance.now() - start;
        return result;
    }

    // ─── 4. Meal plan ────────────────────────────────────────────
    if (MEAL_PLAN_PATTERNS.some(p => p.test(t))) {
        result.intent = INTENTS.MEAL_PLAN;
        result.parseTimeMs = performance.now() - start;
        return result;
    }

    // ─── 5. Remove item ──────────────────────────────────────────
    if (REMOVE_PATTERNS.some(p => p.test(t))) {
        result.intent = INTENTS.REMOVE_ITEM;
        result.parseTimeMs = performance.now() - start;
        return result;
    }

    // ─── 5.5 Multi-restaurant order ─────────────────────────────
    // Detect: "X from A and Y from B" patterns (multiple from clauses)
    if (isMultiOrder(t)) {
        result.intent = INTENTS.MULTI_ORDER;
        result.parseTimeMs = performance.now() - start;
        return result;
    }

    // ─── 6. Change restaurant ────────────────────────────────────
    if (restaurants.length > 0) {
        const switchRegex = /^(?:change|switch|move|go)\s+(?:to|the\s+restaurant\s+to)\s+/i;
        const fromRegex = /(?:from|at|in)\s+(.+?)(?:\s+restaurant|\s+menu)?\s*$/i;
        const selectRegex = /^(?:show|open|select|pick|choose|try|use|browse|order\s+from)\s+/i;
        // Handle 'I want to select X restaurant', 'can you select the restaurant X', 'take me to X', 'let's try X'
        const wantSelectRegex = /(?:i\s+want\s+(?:to\s+)?(?:select|go\s+to|try|visit|order\s+from|eat\s+(?:at|from))\s+|take\s+me\s+to\s+|let'?s?\s+(?:go\s+to|try|eat\s+at)\s+|(?:can|could|would)\s+you\s+(?:please\s+)?(?:select|switch\s+to|change\s+to|go\s+to|open|show)\s+(?:the\s+)?(?:restaurant\s+)?|please\s+(?:select|switch\s+to|change\s+to|go\s+to|open)\s+(?:the\s+)?(?:restaurant\s+)?)(.+?)(?:\s+restaurant|\s+menu)?\s*$/i;

        let candidateName = null;

        if (switchRegex.test(t)) {
            candidateName = t.replace(switchRegex, '').trim();
        } else if (wantSelectRegex.test(t)) {
            candidateName = t.match(wantSelectRegex)?.[1]?.trim();
        } else if (fromRegex.test(t)) {
            candidateName = t.match(fromRegex)?.[1]?.trim();
        } else if (selectRegex.test(t)) {
            candidateName = t.replace(selectRegex, '').trim();
        }

        if (candidateName) {
            const match = fuzzyMatchRestaurant(candidateName, restaurants);
            if (match) {
                result.intent = INTENTS.CHANGE_RESTAURANT;
                result.restaurantMatch = match;
                result.stateUpdate = { restaurant: match.name, restaurantId: match.id };
                result.parseTimeMs = performance.now() - start;
                return result;
            }
        }

        // Also check if the entire input IS a restaurant name
        const directMatch = fuzzyMatchRestaurant(t, restaurants);
        if (directMatch && !extractDish(t)) {
            result.intent = INTENTS.CHANGE_RESTAURANT;
            result.restaurantMatch = directMatch;
            result.stateUpdate = { restaurant: directMatch.name, restaurantId: directMatch.id };
            result.parseTimeMs = performance.now() - start;
            return result;
        }
    }

    // ─── 7. Extract entities ─────────────────────────────────────
    const entities = extractEntities(t);
    result.entities = entities;

    // ─── 8. Filter update (modifier on existing results) ─────────
    if (convState.dish || convState.lastResults) {
        if (FILTER_UPDATE_PATTERNS.some(p => p.test(t))) {
            result.intent = INTENTS.FILTER_UPDATE;
            result.stateUpdate = {};

            // Parse what's being updated
            if (/cheap(?:er)?|low(?:er)?\s*price|budget|affordable/i.test(t)) {
                result.stateUpdate.priceRange = 'cheap';
                result.stateUpdate.sortBy = 'price';
            }
            if (/expensive|premium|high.?end|fancy/i.test(t)) {
                result.stateUpdate.priceRange = 'expensive';
            }
            if (/veg(?:etarian)?(?!.*non)/i.test(t) && !/non.?veg/i.test(t)) {
                result.stateUpdate.diet = 'vegetarian';
            }
            if (/non.?veg/i.test(t)) {
                result.stateUpdate.diet = 'non-veg';
            }
            if (/vegan/i.test(t)) {
                result.stateUpdate.diet = 'vegan';
            }
            if (/halal/i.test(t)) {
                result.stateUpdate.diet = 'halal';
            }
            if (/spic(?:y|ier)/i.test(t)) {
                result.stateUpdate.spice = 'spicy';
            }
            if (/mild(?:er)?/i.test(t)) {
                result.stateUpdate.spice = 'mild';
            }

            // Price constraint
            const priceMatch = t.match(/(?:under|below|max|budget)\s*\$?\s*(\d+)/i);
            if (priceMatch) result.stateUpdate.priceMax = parseInt(priceMatch[1], 10);

            // Rating
            const ratingMatch = t.match(/(\d+)\s*(?:star|rating)/i);
            if (ratingMatch) result.stateUpdate.rating = parseInt(ratingMatch[1], 10);

            // Sort
            const sortMatch = t.match(/sort\s+by\s+(price|rating|distance|popular)/i);
            if (sortMatch) result.stateUpdate.sortBy = sortMatch[1];

            // Merge any extracted entities
            if (entities.dish) result.stateUpdate.dish = entities.dish;
            if (entities.protein) result.stateUpdate.protein = entities.protein;
            if (entities.cuisine) result.stateUpdate.cuisine = entities.cuisine;

            result.parseTimeMs = performance.now() - start;
            return result;
        }
    }

    // ─── 9. Add to cart ──────────────────────────────────────────
    if (ADD_TO_CART_PATTERNS.some(p => p.test(t))) {
        result.intent = INTENTS.ADD_TO_CART;
        // Extract quantity
        const qtyMatch = t.match(/(\d+)\s+/);
        if (qtyMatch) result.entities.quantity = parseInt(qtyMatch[1], 10);
        result.parseTimeMs = performance.now() - start;
        return result;
    }

    // ─── 10. New search (default for food queries) ───────────────
    if (entities.dish || entities.protein || entities.cuisine || entities.priceMax) {
        result.intent = INTENTS.NEW_SEARCH;
        result.stateUpdate = {
            dish: entities.dish,
            protein: entities.protein,
            cuisine: entities.cuisine,
            spice: entities.spice,
            diet: entities.diet,
            priceMax: entities.priceMax,
            priceRange: entities.priceMax ? (entities.priceMax <= 10 ? 'cheap' : entities.priceMax <= 20 ? 'mid' : 'expensive') : null,
        };
        result.parseTimeMs = performance.now() - start;
        return result;
    }

    // ─── 11. Unclear — let backend handle it ─────────────────────
    result.intent = INTENTS.UNCLEAR;
    result.parseTimeMs = performance.now() - start;
    return result;
}

// ─── Helper: extract entities from text ──────────────────────────────
function extractEntities(t) {
    const entities = {};

    // Price
    const priceMatch = t.match(/(?:under|below|less\s+than|max|up\s+to|within|budget)\s*\$?\s*(\d+)/i)
        || t.match(/\$?\s*(\d+)\s*(?:or\s+less|max|budget|dollars?)/i);
    if (priceMatch) entities.priceMax = parseInt(priceMatch[1], 10);

    // Detect "cheap" as a price signal
    if (/\bcheap(?:est|er)?\b|\bbudget\b|\baffordable\b|\blow\s*price/i.test(t)) {
        entities.priceRange = 'cheap';
    }

    // Protein
    for (const p of PROTEINS) {
        if (t.includes(p)) { entities.protein = p; break; }
    }

    // Spice (check longer phrases first)
    for (const s of SPICE_LEVELS) {
        if (t.includes(s)) { entities.spice = s; break; }
    }

    // Cuisine (check longer phrases first)
    for (const c of CUISINES) {
        if (t.includes(c)) { entities.cuisine = c; break; }
    }

    // Diet
    for (const d of DIETS) {
        if (t.includes(d)) { entities.diet = d; break; }
    }

    // Dish (longest match first)
    entities.dish = extractDish(t);

    // Quantity
    const qtyMatch = t.match(/(\d+)\s*(?:of|pieces?|plates?|servings?|orders?)/i);
    if (qtyMatch) entities.quantity = parseInt(qtyMatch[1], 10);

    return entities;
}

function extractDish(t) {
    const sortedDishes = [...DISHES].sort((a, b) => b.length - a.length);
    for (const d of sortedDishes) {
        if (t.includes(d)) return d;
    }
    return null;
}

// ─── Helper: fuzzy match restaurant name ─────────────────────────────
function fuzzyMatchRestaurant(name, restaurants) {
    const lower = name.toLowerCase().replace(/restaurant|menu/gi, '').trim();
    if (!lower) return null;

    // Try exact match first
    let match = restaurants.find(r => r.name.toLowerCase() === lower || (r.slug || '').toLowerCase() === lower);
    if (match) return match;

    // Try substring match
    match = restaurants.find(r =>
        r.name.toLowerCase().includes(lower) || lower.includes(r.name.toLowerCase())
        || (r.slug || '').toLowerCase().includes(lower)
    );
    return match || null;
}

/**
 * Detect if input is a multi-restaurant order.
 * Matches patterns like:
 *   "1 butter masala from aroma and 2 chicken biryani from desi district"
 *   "order pizza from dominos, biryani from spice garden"
 *   "i want naan from aroma and samosa from spice garden"
 */
export function isMultiOrder(text) {
    const t = text.toLowerCase().trim();
    // Count "from X" clauses — if 2+, it's a multi-order
    const fromMatches = t.match(/(?:from|at)\s+\w+/gi);
    if (fromMatches && fromMatches.length >= 2) return true;

    // Also catch: "N item from X and N item from Y" with separator
    if (/\d*\s*\w+.*?\s+(?:from|at)\s+\w+.*?(?:and|,)\s*\d*\s*\w+.*?\s+(?:from|at)\s+\w+/i.test(t)) {
        return true;
    }

    return false;
}

/**
 * Build a search query string from intent result
 * Combines intent entities with conversation state
 */
export function buildSearchQuery(intentResult, convState = {}) {
    const merged = { ...convState, ...intentResult.stateUpdate };
    const parts = [];
    if (merged.priceRange) parts.push(merged.priceRange);
    if (merged.diet) parts.push(merged.diet);
    if (merged.spice) parts.push(merged.spice);
    if (merged.protein) parts.push(merged.protein);
    if (merged.dish) parts.push(merged.dish);
    if (merged.cuisine) parts.push(merged.cuisine);
    if (merged.priceMax) parts.push(`under $${merged.priceMax}`);
    return parts.join(' ') || intentResult.raw;
}
