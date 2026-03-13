/**
 * ConversationState.js — Structured conversation context manager
 * 
 * Maintains accumulated filters across turns so the AI understands
 * "change restaurant to X" means keep existing dish/price/diet filters.
 * 
 * State persists across conversation turns until explicitly reset.
 */

/**
 * Create a fresh conversation state
 */
export function createState() {
    return {
        dish: null,           // "biryani", "pizza", etc.
        protein: null,        // "chicken", "paneer", etc.
        cuisine: null,        // "indian", "chinese", etc.
        spice: null,          // "spicy", "mild", etc.
        diet: null,           // "vegetarian", "vegan", "halal", etc.
        priceMax: null,       // 15 (dollars)
        priceMin: null,       // 5  (dollars)
        priceRange: null,     // "cheap", "mid", "expensive"
        restaurant: null,     // Restaurant name or slug
        restaurantId: null,   // Restaurant ID
        quantity: 1,
        rating: null,         // Minimum rating filter
        sortBy: null,         // "price", "rating", "distance"
        lastQuery: null,      // Raw text of last query
        lastResults: null,    // Results from last search
        turnCount: 0,         // Number of turns in conversation
    };
}

/**
 * Apply an intent update to the state
 * Only modifies fields that are present in the update
 * @param {object} state - Current state
 * @param {object} update - Partial fields to update
 * @returns {object} New state (immutable)
 */
export function applyUpdate(state, update) {
    const newState = { ...state };

    // Only update fields that are explicitly set (not null/undefined)
    for (const [key, value] of Object.entries(update)) {
        if (value !== undefined && value !== null) {
            newState[key] = value;
        }
    }

    newState.turnCount = (state.turnCount || 0) + 1;
    return newState;
}

/**
 * Build a search query string from accumulated state
 * Used for the searchByIntent API call
 * @param {object} state - Current conversation state
 * @returns {string} Search query
 */
export function buildQuery(state) {
    const parts = [];
    if (state.priceRange) parts.push(state.priceRange);
    if (state.diet) parts.push(state.diet);
    if (state.spice) parts.push(state.spice);
    if (state.protein) parts.push(state.protein);
    if (state.dish) parts.push(state.dish);
    if (state.cuisine) parts.push(state.cuisine + ' food');
    if (state.priceMax) parts.push(`under $${state.priceMax}`);
    return parts.join(' ') || state.lastQuery || '';
}

/**
 * Build a description of active filters for the AI response
 * @param {object} state - Current conversation state
 * @returns {string} Human-readable filter description
 */
export function describeFilters(state) {
    const parts = [];
    if (state.dish) parts.push(`**${state.dish}**`);
    if (state.protein) parts.push(state.protein);
    if (state.spice) parts.push(state.spice);
    if (state.diet) parts.push(state.diet);
    if (state.cuisine) parts.push(state.cuisine);
    if (state.priceRange) parts.push(state.priceRange);
    if (state.priceMax) parts.push(`under $${state.priceMax}`);
    if (state.restaurant) parts.push(`from ${state.restaurant}`);
    return parts.join(', ') || 'all items';
}

/**
 * Reset specific fields when user starts a completely new search
 * @param {object} state - Current state
 * @returns {object} Reset state preserving restaurant context
 */
export function resetForNewSearch(state) {
    return {
        ...createState(),
        restaurant: state.restaurant,
        restaurantId: state.restaurantId,
        turnCount: state.turnCount + 1,
    };
}

export default { createState, applyUpdate, buildQuery, describeFilters, resetForNewSearch };
