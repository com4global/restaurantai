/**
 * test_voice_modules.mjs — Unit tests for IntentParser + ConversationState
 * 
 * Run with: node --experimental-vm-modules frontend/src/voice/test_voice_modules.mjs
 * 
 * Tests 7 categories:
 * 1. Intent Classification (13 intents)
 * 2. Entity Extraction (dish, protein, price, spice, cuisine, diet)
 * 3. Restaurant Matching (fuzzy, exact, substring)
 * 4. Filter Updates (modify existing results)
 * 5. Conversation State (accumulation, reset, query building)
 * 6. Edge Cases (empty, short, ambiguous input)
 * 7. Full Conversation Flows (multi-turn scenarios)
 */

// Polyfill performance for Node.js
if (typeof performance === 'undefined') {
    const { performance: perf } = await import('perf_hooks');
    global.performance = perf;
}

import { parseIntent, INTENTS, buildSearchQuery } from './IntentParser.js';
import { createState, applyUpdate, buildQuery, describeFilters, resetForNewSearch } from './ConversationState.js';

let passed = 0;
let failed = 0;
let total = 0;

function assert(condition, testName) {
    total++;
    if (condition) {
        passed++;
        console.log(`  ✅ ${testName}`);
    } else {
        failed++;
        console.log(`  ❌ ${testName}`);
    }
}

function section(name) {
    console.log(`\n━━━ ${name} ━━━`);
}

// Mock restaurants for testing
const MOCK_RESTAURANTS = [
    { id: 1, name: 'Desi District', slug: 'desi-district' },
    { id: 2, name: 'Debug Pizza', slug: 'debug-pizza' },
    { id: 3, name: 'Spice Garden', slug: 'spice-garden' },
    { id: 4, name: 'Tandoori Nights', slug: 'tandoori-nights' },
];

// ═══════════════════════════════════════════════════════════════════
// 1. INTENT CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════
section('1. Intent Classification');

// Greetings
assert(parseIntent('hello', {}, []).intent === INTENTS.GREETING, 'hello → GREETING');
assert(parseIntent('hi', {}, []).intent === INTENTS.GREETING, 'hi → GREETING');
assert(parseIntent('hey', {}, []).intent === INTENTS.GREETING, 'hey → GREETING');
assert(parseIntent('can you hear me', {}, []).intent === INTENTS.GREETING, 'can you hear me → GREETING');
assert(parseIntent('good morning', {}, []).intent === INTENTS.GREETING, 'good morning → GREETING');
assert(parseIntent('mic test', {}, []).intent === INTENTS.GREETING, 'mic test → GREETING');

// Help
assert(parseIntent('what can you do', {}, []).intent === INTENTS.HELP, 'what can you do → HELP');
assert(parseIntent('help me', {}, []).intent === INTENTS.HELP, 'help me → HELP');

// Thanks
assert(parseIntent('thanks', {}, []).intent === INTENTS.THANKS, 'thanks → THANKS');
assert(parseIntent('thank you', {}, []).intent === INTENTS.THANKS, 'thank you → THANKS');

// Goodbye
assert(parseIntent('bye', {}, []).intent === INTENTS.GOODBYE, 'bye → GOODBYE');
assert(parseIntent('goodbye', {}, []).intent === INTENTS.GOODBYE, 'goodbye → GOODBYE');

// Checkout
assert(parseIntent('checkout', {}, []).intent === INTENTS.CHECKOUT, 'checkout → CHECKOUT');
assert(parseIntent('place order', {}, []).intent === INTENTS.CHECKOUT, 'place order → CHECKOUT');
assert(parseIntent("i'm done", {}, []).intent === INTENTS.CHECKOUT, "i'm done → CHECKOUT");

// Show cart
assert(parseIntent('view cart', {}, []).intent === INTENTS.SHOW_CART, 'view cart → SHOW_CART');
assert(parseIntent("what's in my cart", {}, []).intent === INTENTS.SHOW_CART, "what's in my cart → SHOW_CART");

// Meal plan
assert(parseIntent('plan meals for the week', {}, []).intent === INTENTS.MEAL_PLAN, 'plan meals → MEAL_PLAN');
assert(parseIntent('weekly meal plan', {}, []).intent === INTENTS.MEAL_PLAN, 'weekly meal plan → MEAL_PLAN');
assert(parseIntent('create meal plan', {}, []).intent === INTENTS.MEAL_PLAN, 'create meal plan → MEAL_PLAN');

// ═══════════════════════════════════════════════════════════════════
// 2. ENTITY EXTRACTION  
// ═══════════════════════════════════════════════════════════════════
section('2. Entity Extraction');

const r1 = parseIntent('cheap chicken biryani', {}, []);
assert(r1.entities.dish === 'biryani', 'extracts dish: biryani');
assert(r1.entities.protein === 'chicken', 'extracts protein: chicken');
assert(r1.entities.priceRange === 'cheap', 'extracts priceRange: cheap');
assert(r1.intent === INTENTS.NEW_SEARCH, 'cheap chicken biryani → NEW_SEARCH');

const r2 = parseIntent('spicy paneer tikka under $15', {}, []);
assert(r2.entities.dish === 'paneer', 'extracts dish: paneer (longest match in "paneer tikka")');
assert(r2.entities.protein === 'paneer', 'extracts protein: paneer');
assert(r2.entities.spice === 'spicy', 'extracts spice: spicy');
assert(r2.entities.priceMax === 15, 'extracts priceMax: 15');

const r3 = parseIntent('vegetarian indian food', {}, []);
assert(r3.entities.diet === 'vegetarian', 'extracts diet: vegetarian');
assert(r3.entities.cuisine === 'indian', 'extracts cuisine: indian');

const r4 = parseIntent('pizza', {}, []);
assert(r4.entities.dish === 'pizza', 'extracts dish: pizza');
assert(r4.intent === INTENTS.NEW_SEARCH, 'pizza → NEW_SEARCH');

const r5 = parseIntent('halal lamb kebab', {}, []);
assert(r5.entities.diet === 'halal', 'extracts diet: halal');
assert(r5.entities.protein === 'lamb', 'extracts protein: lamb');
assert(r5.entities.dish === 'kebab', 'extracts dish: kebab');

// ═══════════════════════════════════════════════════════════════════
// 3. RESTAURANT MATCHING
// ═══════════════════════════════════════════════════════════════════
section('3. Restaurant Matching');

const rc1 = parseIntent('change to desi district', {}, MOCK_RESTAURANTS);
assert(rc1.intent === INTENTS.CHANGE_RESTAURANT, 'change to desi district → CHANGE_RESTAURANT');
assert(rc1.restaurantMatch?.name === 'Desi District', 'matches Desi District');

const rc2 = parseIntent('switch to debug pizza', {}, MOCK_RESTAURANTS);
assert(rc2.intent === INTENTS.CHANGE_RESTAURANT, 'switch to debug pizza → CHANGE_RESTAURANT');
assert(rc2.restaurantMatch?.name === 'Debug Pizza', 'matches Debug Pizza');

const rc3 = parseIntent('go to spice garden', {}, MOCK_RESTAURANTS);
assert(rc3.intent === INTENTS.CHANGE_RESTAURANT, 'go to spice garden → CHANGE_RESTAURANT');
assert(rc3.restaurantMatch?.name === 'Spice Garden', 'matches Spice Garden');

const rc4 = parseIntent('order from tandoori nights', {}, MOCK_RESTAURANTS);
assert(rc4.intent === INTENTS.CHANGE_RESTAURANT, 'order from tandoori nights → CHANGE_RESTAURANT');
assert(rc4.restaurantMatch?.name === 'Tandoori Nights', 'matches Tandoori Nights');

// Partial match
const rc5 = parseIntent('change to desi', {}, MOCK_RESTAURANTS);
assert(rc5.intent === INTENTS.CHANGE_RESTAURANT, 'change to desi → CHANGE_RESTAURANT (partial)');
assert(rc5.restaurantMatch?.name === 'Desi District', 'partial match: desi → Desi District');

// ═══════════════════════════════════════════════════════════════════
// 4. FILTER UPDATES
// ═══════════════════════════════════════════════════════════════════
section('4. Filter Updates');

const existingState = { dish: 'biryani', priceRange: 'cheap', lastResults: [1, 2, 3] };

const fu1 = parseIntent('make it vegetarian', existingState, []);
assert(fu1.intent === INTENTS.FILTER_UPDATE, 'make it vegetarian → FILTER_UPDATE');
assert(fu1.stateUpdate.diet === 'vegetarian', 'stateUpdate includes diet: vegetarian');

const fu2 = parseIntent('show cheaper', existingState, []);
assert(fu2.intent === INTENTS.FILTER_UPDATE, 'show cheaper → FILTER_UPDATE');
assert(fu2.stateUpdate.priceRange === 'cheap', 'stateUpdate includes priceRange: cheap');

const fu3 = parseIntent('only veg', existingState, []);
assert(fu3.intent === INTENTS.FILTER_UPDATE, 'only veg → FILTER_UPDATE');

const fu4 = parseIntent('make it spicy', existingState, []);
assert(fu4.intent === INTENTS.FILTER_UPDATE, 'make it spicy → FILTER_UPDATE');
assert(fu4.stateUpdate.spice === 'spicy', 'stateUpdate includes spice: spicy');

const fu5 = parseIntent('under $10', existingState, []);
assert(fu5.intent === INTENTS.FILTER_UPDATE, 'under $10 → FILTER_UPDATE');
assert(fu5.stateUpdate.priceMax === 10, 'stateUpdate includes priceMax: 10');

// ═══════════════════════════════════════════════════════════════════
// 5. CONVERSATION STATE
// ═══════════════════════════════════════════════════════════════════
section('5. Conversation State');

const s0 = createState();
assert(s0.dish === null, 'createState: dish is null');
assert(s0.turnCount === 0, 'createState: turnCount is 0');

const s1 = applyUpdate(s0, { dish: 'biryani', priceRange: 'cheap' });
assert(s1.dish === 'biryani', 'applyUpdate: sets dish');
assert(s1.priceRange === 'cheap', 'applyUpdate: sets priceRange');
assert(s1.turnCount === 1, 'applyUpdate: increments turnCount');
assert(s0.dish === null, 'applyUpdate: original state unchanged (immutable)');

const s2 = applyUpdate(s1, { restaurant: 'Desi District' });
assert(s2.dish === 'biryani', 'applyUpdate: keeps dish from s1');
assert(s2.priceRange === 'cheap', 'applyUpdate: keeps priceRange from s1');
assert(s2.restaurant === 'Desi District', 'applyUpdate: adds restaurant');
assert(s2.turnCount === 2, 'applyUpdate: turnCount is 2');

const s3 = applyUpdate(s2, { diet: 'vegetarian' });
assert(s3.dish === 'biryani', 'applyUpdate: keeps dish through 3 turns');
assert(s3.restaurant === 'Desi District', 'applyUpdate: keeps restaurant');
assert(s3.diet === 'vegetarian', 'applyUpdate: adds diet');

// Build query
const q1 = buildQuery(s3);
assert(q1.includes('biryani'), 'buildQuery: includes dish');
assert(q1.includes('vegetarian'), 'buildQuery: includes diet');
assert(q1.includes('cheap'), 'buildQuery: includes priceRange');

// Describe filters
const d1 = describeFilters(s3);
assert(d1.includes('biryani'), 'describeFilters: includes dish');
assert(d1.includes('vegetarian'), 'describeFilters: includes diet');
assert(d1.includes('Desi District'), 'describeFilters: includes restaurant');

// Reset for new search
const s4 = resetForNewSearch(s3);
assert(s4.dish === null, 'resetForNewSearch: clears dish');
assert(s4.diet === null, 'resetForNewSearch: clears diet');
assert(s4.restaurant === 'Desi District', 'resetForNewSearch: keeps restaurant');

// ═══════════════════════════════════════════════════════════════════
// 6. EDGE CASES
// ═══════════════════════════════════════════════════════════════════
section('6. Edge Cases');

const e1 = parseIntent('', {}, []);
assert(e1.intent === INTENTS.UNCLEAR, 'empty string → UNCLEAR');

const e2 = parseIntent('a', {}, []);
assert(e2.intent !== INTENTS.NEW_SEARCH, 'single char → not NEW_SEARCH');

const e3 = parseIntent('asdfghjkl', {}, []);
assert(e3.intent === INTENTS.UNCLEAR, 'nonsense → UNCLEAR');

const e4 = parseIntent('I want to eat something', {}, []);
assert(e4.intent === INTENTS.ADD_TO_CART || e4.intent === INTENTS.UNCLEAR || e4.intent === INTENTS.NEW_SEARCH, 'vague → ADD_TO_CART/UNCLEAR/NEW_SEARCH ("I want" triggers cart)');

// Performance check
const perfResult = parseIntent('spicy chicken biryani under $15 from desi district', {}, MOCK_RESTAURANTS);
assert(perfResult.parseTimeMs < 50, `parse time < 50ms (actual: ${perfResult.parseTimeMs.toFixed(2)}ms)`);

// ═══════════════════════════════════════════════════════════════════
// 7. FULL CONVERSATION FLOWS
// ═══════════════════════════════════════════════════════════════════
section('7. Full Conversation Flows');

// Flow 1: Search → Change restaurant → Filter
let state = createState();

const turn1 = parseIntent('cheap biryani', state, MOCK_RESTAURANTS);
assert(turn1.intent === INTENTS.NEW_SEARCH, 'Flow1 Turn1: NEW_SEARCH');
state = applyUpdate(state, turn1.stateUpdate);
state.lastResults = ['mock1', 'mock2'];
assert(state.dish === 'biryani', 'Flow1: state has biryani');

const turn2 = parseIntent('change to desi district', state, MOCK_RESTAURANTS);
assert(turn2.intent === INTENTS.CHANGE_RESTAURANT, 'Flow1 Turn2: CHANGE_RESTAURANT');
state = applyUpdate(state, turn2.stateUpdate);
assert(state.dish === 'biryani', 'Flow1: biryani preserved after restaurant change');
assert(state.restaurant === 'Desi District', 'Flow1: restaurant is Desi District');

const turn3 = parseIntent('make it vegetarian', state, MOCK_RESTAURANTS);
assert(turn3.intent === INTENTS.FILTER_UPDATE, 'Flow1 Turn3: FILTER_UPDATE');
state = applyUpdate(state, turn3.stateUpdate);
assert(state.dish === 'biryani', 'Flow1: biryani still preserved');
assert(state.restaurant === 'Desi District', 'Flow1: restaurant still Desi District');
assert(state.diet === 'vegetarian', 'Flow1: diet is vegetarian');

const query = buildQuery(state);
assert(query.includes('biryani'), 'Flow1: query has biryani');
assert(query.includes('vegetarian'), 'Flow1: query has vegetarian');

// Flow 2: Add to cart → Checkout
const addResult = parseIntent('add 2 biryani', {}, []);
assert(addResult.intent === INTENTS.ADD_TO_CART, 'Flow2: add 2 biryani → ADD_TO_CART');

const checkoutResult = parseIntent('place order', {}, []);
assert(checkoutResult.intent === INTENTS.CHECKOUT, 'Flow2: place order → CHECKOUT');

// ═══════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════
console.log('\n═══════════════════════════════════════════════');
console.log(`RESULTS: ${passed} passed, ${failed} failed, ${total} total`);
console.log('═══════════════════════════════════════════════');

if (failed > 0) {
    process.exit(1);
} else {
    console.log('✅ All tests passed!');
    process.exit(0);
}
