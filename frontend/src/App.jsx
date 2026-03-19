import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { listRestaurants, fetchNearby, login, register, sendMessage, fetchCart, addComboToCart, removeCartItem, clearCart, checkout, fetchMyOrders, voiceSTT, voiceTTS, voiceChat, createCheckoutSession, verifyPayment, trackOrder, getRestaurantQueue, mealOptimizer, searchMenuItems, fetchPopularItems, searchByIntent, generateMealPlan, swapMeal, fetchDineInRestaurant, placeDineInOrder, multiOrder } from "./api.js";
import OwnerPortal from "./OwnerPortal.jsx";
import { useVoiceController } from "./voice/useVoiceController.js";

const RADIUS_OPTIONS = [5, 10, 15, 25, 50];

// Smart food emoji mapper
const FOOD_EMOJI_MAP = [
  [/pizza|pie|margherita|pepperoni|calzone|supreme/i, "🍕"],
  [/burger|hamburger|cheeseburger/i, "🍔"],
  [/fries|french fries|potato/i, "🍟"],
  [/hot ?dog/i, "🌭"],
  [/taco/i, "🌮"],
  [/burrito|wrap|quesadilla/i, "🌯"],
  [/salad|caesar|garden|coleslaw/i, "🥗"],
  [/soup|chowder|bisque|stew/i, "🍲"],
  [/steak|ribeye|filet|sirloin|beef/i, "🥩"],
  [/chicken|wing|tender|nugget|poultry/i, "🍗"],
  [/fish|salmon|tuna|cod|shrimp|seafood|lobster|crab/i, "🐟"],
  [/sushi|sashimi|maki|roll/i, "🍣"],
  [/ramen|noodle|pho|udon|lo mein|pad thai/i, "🍜"],
  [/rice|fried rice|biryani|risotto/i, "🍚"],
  [/pasta|spaghetti|penne|linguine|fettuccine|mac/i, "🍝"],
  [/sandwich|sub|panini|club|blt|hoagie/i, "🥪"],
  [/bread|toast|baguette|roll|biscuit|garlic bread|naan/i, "🍞"],
  [/cake|cheesecake|brownie|tiramisu/i, "🍰"],
  [/ice cream|gelato|sundae|frozen/i, "🍨"],
  [/cookie|biscuit/i, "🍪"],
  [/donut|doughnut/i, "🍩"],
  [/pie|cobbler|tart/i, "🥧"],
  [/coffee|espresso|latte|cappuccino|mocha/i, "☕"],
  [/tea|chai|matcha/i, "🍵"],
  [/beer|ale|lager|ipa|stout/i, "🍺"],
  [/wine|merlot|cabernet|chardonnay/i, "🍷"],
  [/cocktail|martini|margarita|mojito/i, "🍸"],
  [/juice|smoothie|lemonade/i, "🧃"],
  [/soda|cola|sprite|pepsi|coke|drink|beverage/i, "🥤"],
  [/water|sparkling/i, "💧"],
  [/egg|omelet|omelette|benedict|scramble/i, "🍳"],
  [/pancake|waffle|french toast|crepe/i, "🥞"],
  [/cheese|mozzarella|cheddar|gouda/i, "🧀"],
  [/nachos|chip|guac|salsa/i, "🫔"],
  [/curry|tikka|masala|vindaloo/i, "🍛"],
  [/bbq|barbecue|ribs|brisket|pulled pork|smoked/i, "🔥"],
  [/corn|cob/i, "🌽"],
  [/mushroom/i, "🍄"],
  [/pepper|jalapeño|chili/i, "🌶️"],
  [/tomato|marinara/i, "🍅"],
  [/apple|fruit/i, "🍎"],
  [/chocolate|cocoa/i, "🍫"],
  [/catering/i, "📦"],
];

function getFoodEmoji(name = "", category = "") {
  const text = `${name} ${category}`.toLowerCase();
  for (const [regex, emoji] of FOOD_EMOJI_MAP) {
    if (regex.test(text)) return emoji;
  }
  return "🍽️";
}

// Distinct gradient colors for restaurant cards
const CARD_GRADIENTS = [
  ['#1a1a2e', '#e94560'],
  ['#0f3460', '#16213e'],
  ['#2d132c', '#ee4c7c'],
  ['#1b262c', '#0f4c75'],
  ['#1a1a40', '#7952b3'],
  ['#0d1117', '#238636'],
  ['#1e1e3f', '#e07c24'],
  ['#162447', '#1f4068'],
  ['#2c003e', '#d4418e'],
  ['#0a192f', '#64ffda'],
];

// Smart restaurant → image mapping
const RESTAURANT_IMAGE_MAP = [
  [/desi|district|indian/i, '/food-images/food_indian_thali.png'],
  [/triveni|supermarket|grocery/i, '/food-images/food_indian_grocery.png'],
  [/bbq|barbecue|southern|grill|smoke/i, '/food-images/food_bbq_platter.png'],
  [/thai|orchid|pad|pho/i, '/food-images/food_thai_spread.png'],
  [/domino|pizza|hut|papa/i, '/food-images/food_pizza_fresh.png'],
  [/aroma|italian|pasta|olive/i, '/food-images/food_italian_aroma.png'],
];

function getRestaurantImage(name = '') {
  const text = name.toLowerCase();
  for (const [regex, img] of RESTAURANT_IMAGE_MAP) {
    if (regex.test(text)) return img;
  }
  return null; // falls back to gradient
}

// Smart food item/category → image mapping
const FOOD_IMAGE_MAP = [
  [/biryani|biriyani|pulao|pulav|rice|fried rice/i, '/food-images/food_biryani.png'],
  [/snack|samosa|pakora|chaat|appetizer|starter|bhaji|pani puri|bhel/i, '/food-images/food_snacks_plate.png'],
  [/curry|masala|tikka|butter chicken|paneer|dal|gravy|korma|vindaloo/i, '/food-images/food_curry_bowl.png'],
  [/naan|bread|roti|paratha|kulcha|garlic|chapati|puri/i, '/food-images/food_naan_bread.png'],
  [/dessert|sweet|gulab|jalebi|kheer|halwa|rasgulla|cake|mithai/i, '/food-images/food_desserts_indian.png'],
  [/drink|lassi|chai|tea|coffee|juice|beverage|smoothie|milkshake/i, '/food-images/food_drinks_lassi.png'],
  [/falooda|faluda/i, '/food-images/food_falooda.png'],
  [/frankie|kathi|roll|wrap/i, '/food-images/food_frankie_wrap.png'],
  [/tiffin|breakfast|dosa|idli|vada|upma|uttapam|poha/i, '/food-images/food_tiffin_breakfast.png'],
  [/indo.?chinese|chinese|manchurian|hakka|noodle|chilli|gobi|schezwan/i, '/food-images/food_indo_chinese.png'],
  [/chat(?!.*bot)|chaat|puri|sev|papdi|bhel/i, '/food-images/food_chaat_street.png'],
  [/burger|hamburger|cheeseburger/i, '/food-images/food_burger_desi.png'],
  [/combo|meal|deal|buy 1|bogo|value|offer/i, '/food-images/food_combo_meal.png'],
  [/pizza|pie|margherita|pepperoni/i, '/food-images/food_pizza_fresh.png'],
  [/bbq|ribs|brisket|pulled|smoked|barbecue/i, '/food-images/food_bbq_platter.png'],
  [/thai|pad|spring roll|tom yum/i, '/food-images/food_thai_spread.png'],
  [/pasta|spaghetti|fettuccine|penne|italian/i, '/food-images/food_italian_aroma.png'],
  [/platter|special|friday|ramadan|festiv|feast/i, '/food-images/food_indian_thali.png'],
  [/new|categor|misc|other/i, '/food-images/food_indian_thali.png'],
];

function getFoodItemImage(name = '', category = '') {
  const text = `${name} ${category}`.toLowerCase();
  for (const [regex, img] of FOOD_IMAGE_MAP) {
    if (regex.test(text)) return img;
  }
  return null; // falls back to emoji
}

const welcomeMsg = {
  role: "bot",
  content: "Hello! Pick a restaurant from the Home tab, then browse menus and add items here.",
};

const API = import.meta.env.VITE_API_BASE || "http://localhost:8000";

export default function App() {
  // Active tab
  const [tab, setTab] = useState("home");

  // Auth
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [status, setStatus] = useState("Ready.");

  // Chat
  const [messageText, setMessageText] = useState("");
  const [messages, setMessages] = useState([welcomeMsg]);
  // Session persisted in localStorage to survive hot reload / refresh
  const [sessionId, _setSessionId] = useState(() => {
    const saved = localStorage.getItem("chat_sessionId");
    return saved ? parseInt(saved, 10) : null;
  });
  const setSessionId = (id) => {
    _setSessionId(id);
    if (id != null) localStorage.setItem("chat_sessionId", String(id));
    else localStorage.removeItem("chat_sessionId");
  };

  // Restaurants
  const [restaurants, setRestaurants] = useState([]);
  const [nearbyPlaces, setNearbyPlaces] = useState([]);
  // Selected restaurant persisted in localStorage
  const [selectedRestaurant, _setSelectedRestaurant] = useState(() => {
    try {
      const saved = localStorage.getItem("chat_selectedRestaurant");
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const setSelectedRestaurant = (r) => {
    _setSelectedRestaurant(r);
    if (r) localStorage.setItem("chat_selectedRestaurant", JSON.stringify({ id: r.id, name: r.name, slug: r.slug }));
    else localStorage.removeItem("chat_selectedRestaurant");
  };

  // Location state
  const [zipcode, setZipcode] = useState(localStorage.getItem("zipcode") || "");
  const [radius, setRadius] = useState(Number(localStorage.getItem("radius")) || 25);
  const [userLat, setUserLat] = useState(null);
  const [userLng, setUserLng] = useState(null);
  const [locationLabel, setLocationLabel] = useState("");
  const [locating, setLocating] = useState(false);
  const [citySearch, setCitySearch] = useState("");
  const [citySuggestions, setCitySuggestions] = useState([]);
  const [showCitySuggestions, setShowCitySuggestions] = useState(false);
  const citySearchTimeout = useRef(null);

  // Categories & Menu items
  const [activeCategories, setActiveCategories] = useState([]);
  const [activeCategoryName, setActiveCategoryName] = useState(null);
  const [currentItems, setCurrentItems] = useState([]);

  // Autocomplete
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredRestaurants, setFilteredRestaurants] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Cart
  const [cartData, setCartData] = useState(null);
  const [showCartPanel, setShowCartPanel] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutDone, setCheckoutDone] = useState(null);
  const [paymentToast, setPaymentToast] = useState(null); // { type: 'success'|'cancel', message: string }

  // Orders
  const [myOrders, setMyOrders] = useState([]);
  const [ordersTab, setOrdersTab] = useState("current");

  // Voice Conversation Mode — powered by useVoiceController hook
  // (manages SpeechRecognizer, IntentParser, TTSPlayer, state machine)
  const doSendRef = useRef(null);
  const voiceSpeakRef = useRef(null);
  const voice = useVoiceController({ apiBase: API, doSendRef });
  const { voiceMode, voiceState, setVoiceState, liveTranscript, voiceTranscript, isListening, voiceModeRef, voiceStateRef } = voice;
  const voiceStartListeningRef = useRef(null);
  const lastVoicePromptRef = useRef(null);
  // Bridge voiceSpeakRef for doSend's fromVoice paths
  useEffect(() => {
    voiceSpeakRef.current = (text) => voice.speak(text);
    voiceStartListeningRef.current = () => voice.startListening();
  }, [voice.speak, voice.startListening]);

  // Owner
  const [showOwnerPortal, setShowOwnerPortal] = useState(() => localStorage.getItem("userRole") === "owner");
  const [userRole, setUserRole] = useState(() => localStorage.getItem("userRole") || "customer");

  // Refs
  const inputRef = useRef(null);
  const chatEndRef = useRef(null);
  const [addedItemId, setAddedItemId] = useState(null);
  // Conversation state (persists filters across turns: dish, price, restaurant, diet)
  const convStateRef = useRef({ dish: null, protein: null, cuisine: null, spice: null, diet: null, priceMax: null, priceMin: null, priceRange: null, restaurant: null, restaurantId: null, quantity: 1, rating: null, sortBy: null, lastQuery: null, lastResults: null, turnCount: 0 });

  // Helper: build sendMessage payload with restaurant_id for session recovery
  const buildChatPayload = (text, overrideSessionId) => {
    const payload = { session_id: overrideSessionId !== undefined ? overrideSessionId : sessionId, text };
    if (selectedRestaurant?.id) payload.restaurant_id = selectedRestaurant.id;
    return payload;
  };

  // Budget Optimizer
  const [showOptimizer, setShowOptimizer] = useState(false);
  const [optPeople, setOptPeople] = useState(5);
  const [optBudget, setOptBudget] = useState(50);
  const [optCuisine, setOptCuisine] = useState("");
  const [optResults, setOptResults] = useState(null);
  const [optLoading, setOptLoading] = useState(false);
  const [optError, setOptError] = useState("");

  // Dine-In Mode (Phase 2)
  const [dineInMode, setDineInMode] = useState(false);
  const [dineInRestaurant, setDineInRestaurant] = useState(null);
  const [dineInTable, setDineInTable] = useState(null);
  const [dineInCart, setDineInCart] = useState([]);
  const [dineInPlacing, setDineInPlacing] = useState(false);
  const [dineInDone, setDineInDone] = useState(null);
  const [dineInCategory, setDineInCategory] = useState(null);

  // ===================== EFFECTS =====================

  useEffect(() => {
    if (token) {
      localStorage.setItem("token", token);
      fetchCart(token).then(setCartData).catch(() => { });
      fetchMyOrders(token).then(setMyOrders).catch(() => { });
    }
  }, [token]);

  useEffect(() => {
    if (!token || showOwnerPortal) return;
    const interval = setInterval(() => {
      fetchMyOrders(token).then(setMyOrders).catch(() => { });
    }, 15000);
    return () => clearInterval(interval);
  }, [token, showOwnerPortal]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Handle Stripe payment redirect URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    const sessionId = params.get('session_id');
    if (!payment) return;

    // Clean URL immediately so refresh doesn't re-trigger
    window.history.replaceState({}, '', window.location.pathname);

    if (payment === 'order_success') {
      setTab('orders');
      setOrdersTab('current');
      setCartData(null);
      setShowCartPanel(false);
      setPaymentToast({ type: 'success', message: '✅ Payment successful! Your order has been confirmed.' });
      setTimeout(() => setPaymentToast(null), 8000);

      // Verify payment and confirm orders on the backend
      const storedToken = token || localStorage.getItem('token');
      if (storedToken && sessionId) {
        verifyPayment(storedToken, sessionId)
          .then(() => fetchMyOrders(storedToken))
          .then(setMyOrders)
          .catch(() => { });
      } else if (storedToken) {
        fetchMyOrders(storedToken).then(setMyOrders).catch(() => { });
      }
    } else if (payment === 'order_cancel') {
      setPaymentToast({ type: 'cancel', message: '❌ Payment was cancelled. Your items are still in the cart.' });
      setTimeout(() => setPaymentToast(null), 6000);
    }
  }, []); // Run once on mount

  // Detect dine-in URL: /dine/{slug}?table=N
  useEffect(() => {
    const path = window.location.pathname;
    const match = path.match(/^\/dine\/([a-z0-9-]+)$/i);
    if (!match) return;
    const slug = match[1];
    const params = new URLSearchParams(window.location.search);
    const table = params.get('table');
    fetchDineInRestaurant(slug, table)
      .then(data => {
        setDineInMode(true);
        setDineInRestaurant(data);
        setDineInTable(data.table_number || table || '1');
        setTab('dine-in');
      })
      .catch(() => {
        // Not a valid dine-in URL or dine-in disabled
        window.history.replaceState({}, '', '/');
      });
  }, []);

  // Fetch restaurants
  const fetchRestaurantsData = useCallback(async (lat, lng, r) => {
    try {
      const params = {};
      if (lat != null && lng != null) { params.lat = lat; params.lng = lng; params.radius_miles = r; }
      const data = await listRestaurants(params);
      setRestaurants(data);
      if (lat != null && lng != null) {
        try {
          const nearby = await fetchNearby({ lat, lng, radius_miles: r });
          setNearbyPlaces(nearby);
        } catch { setNearbyPlaces([]); }
      }
    } catch { setRestaurants([]); }
  }, []);

  // Auto-detect location on mount
  useEffect(() => {
    const savedZip = localStorage.getItem("zipcode");
    if (savedZip) { setZipcode(savedZip); lookupZipcodeAuto(savedZip); return; }
    if (navigator.geolocation) {
      setLocating(true); setLocationLabel("Detecting...");
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = pos.coords.latitude, lng = pos.coords.longitude;
          setUserLat(lat); setUserLng(lng);
          try {
            const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`);
            const geo = await res.json();
            setLocationLabel(`${geo.city || geo.locality || ""}, ${geo.principalSubdivisionCode || geo.countryCode || ""}`);
          } catch { setLocationLabel(`${lat.toFixed(2)}, ${lng.toFixed(2)}`); }
          await fetchRestaurantsData(lat, lng, radius);
          setLocating(false);
        },
        () => { setLocationLabel(""); fetchRestaurantsData(null, null, radius); setLocating(false); },
        { timeout: 5000 }
      );
    } else { fetchRestaurantsData(null, null, radius); }
  }, []);

  const lookupZipcodeAuto = async (zip) => {
    setLocating(true);
    try {
      const res = await fetch(`https://api.zippopotam.us/us/${zip}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const place = data.places[0];
      const lat = parseFloat(place.latitude), lng = parseFloat(place.longitude);
      setUserLat(lat); setUserLng(lng);
      const cityLabel = `${place["place name"]}, ${place["state abbreviation"]}`;
      setLocationLabel(cityLabel); setCitySearch(cityLabel);
      await fetchRestaurantsData(lat, lng, radius);
    } catch { fetchRestaurantsData(null, null, radius); }
    setLocating(false);
  };

  // ===================== LOCATION =====================

  const lookupZipcode = async (zip) => {
    if (!zip || zip.length < 5) return;
    setLocating(true);
    try {
      const res = await fetch(`https://api.zippopotam.us/us/${zip}`);
      if (!res.ok) throw new Error("Invalid zipcode");
      const data = await res.json();
      const place = data.places[0];
      const lat = parseFloat(place.latitude), lng = parseFloat(place.longitude);
      setUserLat(lat); setUserLng(lng);
      const cityLabel = `${place["place name"]}, ${place["state abbreviation"]}`;
      setLocationLabel(cityLabel); setCitySearch(cityLabel);
      localStorage.setItem("zipcode", zip); localStorage.setItem("radius", radius);
      await fetchRestaurantsData(lat, lng, radius);
    } catch { setLocationLabel("Invalid zipcode"); }
    setLocating(false);
  };

  const handleZipcodeChange = (val) => {
    const cleaned = val.replace(/\D/g, "").slice(0, 5);
    setZipcode(cleaned);
    if (cleaned.length === 5) lookupZipcode(cleaned);
  };

  const searchCity = async (query) => {
    if (!query || query.length < 2) { setCitySuggestions([]); return; }
    try {
      const results = [];
      const seenKeys = new Set();
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)},US&format=json&addressdetails=1&limit=6&countrycodes=us`);
      if (res.ok) {
        const data = await res.json();
        for (const item of data) {
          const addr = item.address || {};
          const city = addr.city || addr.town || addr.village || addr.county || "";
          const state = addr.state || "";
          const postcode = addr.postcode || "";
          const zip5 = postcode.split("-")[0].split(" ")[0];
          const key = `${city}-${state}-${zip5}`;
          if (city && !seenKeys.has(key)) {
            seenKeys.add(key);
            results.push({ city, state, zipcode: zip5, lat: parseFloat(item.lat), lng: parseFloat(item.lon), display: `${city}, ${state}${zip5 ? " · " + zip5 : ""}` });
          }
        }
      }
      setCitySuggestions(results.slice(0, 5));
      setShowCitySuggestions(results.length > 0);
    } catch { setCitySuggestions([]); }
  };

  const handleCitySearchChange = (val) => {
    setCitySearch(val);
    if (citySearchTimeout.current) clearTimeout(citySearchTimeout.current);
    citySearchTimeout.current = setTimeout(() => searchCity(val), 400);
  };

  const selectCity = async (suggestion) => {
    setZipcode(suggestion.zipcode || "");
    setCitySearch(`${suggestion.city}, ${suggestion.state}`);
    setLocationLabel(`${suggestion.city}, ${suggestion.state}`);
    setUserLat(suggestion.lat); setUserLng(suggestion.lng);
    setShowCitySuggestions(false);
    if (suggestion.zipcode) localStorage.setItem("zipcode", suggestion.zipcode);
    localStorage.setItem("radius", radius);
    await fetchRestaurantsData(suggestion.lat, suggestion.lng, radius);
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) { setLocationLabel("Not supported"); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        setUserLat(lat); setUserLng(lng);
        setLocationLabel(`${lat.toFixed(4)}, ${lng.toFixed(4)}`);
        await fetchRestaurantsData(lat, lng, radius);
        setLocating(false);
      },
      () => { setLocationLabel("Location denied"); setLocating(false); }
    );
  };

  const handleRadiusChange = async (newRadius) => {
    setRadius(newRadius);
    localStorage.setItem("radius", newRadius);
    if (userLat != null && userLng != null) await fetchRestaurantsData(userLat, userLng, newRadius);
  };

  // ===================== VOICE (ULTRA-LOW LATENCY via useVoiceController) =====================
  // All voice logic (STT, TTS, intent parsing, state machine, barge-in) is in the hook.
  // toggleVoiceMode and startListening are thin wrappers.
  const toggleVoiceMode = () => voice.toggleVoiceMode();
  const startListening = () => voice.toggleVoiceMode();


  // ===================== CHAT / SEND =====================

  const doSend = async (text, fromVoice = false, voiceConfidence = 0) => {
    if (!text.trim()) return;
    const trimmed = text.trim();
    setMessages((p) => [...p, { role: "user", content: trimmed }]);
    setMessageText(""); setShowSuggestions(false); setStatus("Thinking...");

    // ── Intent Router ────────────────────────────────────────────────
    // Classify the message into an intent, then route accordingly.

    // Voice input: run through 5-layer production validation pipeline
    let cleanedText = trimmed;
    if (fromVoice) {
      const { validateVoiceInput, getRejectionMessage } = await import("./voice/VoiceValidator.js");
      const allRestsForValidation = [
        ...restaurants,
        ...nearbyPlaces.map(r => ({ ...r, slug: r.slug || r.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') })),
      ];
      const validation = validateVoiceInput(trimmed, voiceConfidence, allRestsForValidation);

      // Log all layer decisions
      validation.layers.forEach(l => {
        const color = l.startsWith('✅') ? '#00ff88' : l.startsWith('❌') ? '#ff4444' : '#ffaa00';
        console.log(`%c[Validator] ${l}`, `color: ${color}`);
      });

      if (!validation.valid) {
        const msg = getRejectionMessage(validation.reason);
        console.log(`%c[Validator] ❌ REJECTED: ${validation.reason} — "${msg}"`, 'color: #ff4444; font-weight: bold');
        setMessages((p) => [...p, { role: "bot", content: msg }]);
        setStatus("Ready.");
        if (voiceModeRef.current) voiceSpeakRef.current(msg, true);
        return;
      }

      cleanedText = validation.text;
      if (cleanedText !== trimmed.toLowerCase()) {
        console.log(`%c[Validator] ✅ PASSED — cleaned: "${cleanedText}"`, 'color: #00ff88; font-weight: bold');
      }
    }

    // ── Client-side category matching (instant UI response, no backend if matched) ──────
    if (activeCategories.length > 0) {
      const rawInput = (fromVoice ? cleanedText : trimmed).toLowerCase().replace(/[^\w\s]/g, '').trim();
      const isExplicitNav = /^(?:show|open|go\s+to|take\s+me\s+to|category|the)\s+(?:me\s+)?/.test(rawInput);
      const cleanInput = rawInput.replace(/^(?:show|open|go\s+to|take\s+me\s+to|category|the)\s+(?:me\s+)?/, '').trim();
      const wordCount = cleanInput.split(/\s+/).length;

      const matchedCat = activeCategories.find(cat => {
        const catClean = cat.name.toLowerCase().replace(/[^\w\s]/g, '').trim();
        if (cleanInput === catClean || cleanInput === catClean + 's' || cleanInput + 's' === catClean) return true;
        if (isExplicitNav && cleanInput.includes(catClean)) return true;
        if (wordCount <= 2 && cleanInput.includes(catClean)) return true;
        return false;
      });

      if (matchedCat) {
        console.log(`%c[CategoryMatch] ✅ "${fromVoice ? cleanedText : trimmed}" → category "${matchedCat.name}" (id: ${matchedCat.id})`, 'color: #00ff88; font-weight: bold');
        setActiveCategoryName(matchedCat.name);
        if (fromVoice && voiceModeRef.current) {
          voiceSpeakRef.current(`${matchedCat.name}. Which one would you like?`, true);
        }
        try {
          // Pre-fetch items from REST to make UI instantly responsive, same as click
          const apiBase = import.meta.env.VITE_API_BASE || "http://localhost:8000";
          const catRes = await fetch(`${apiBase}/categories/${matchedCat.id}/items`);
          let prefetchedItems = [];
          if (catRes.ok) {
            prefetchedItems = await catRes.json();
            setCurrentItems(prefetchedItems);
          }

          const res = await sendMessage(token, buildChatPayload(`category:${matchedCat.id}`));
          setSessionId(res.session_id);
          // Backend will return items too with new fast-path, but we have them instantly now!
          if (res.items && res.items.length > 0) setCurrentItems(res.items);
          if (res.categories && res.categories.length > 0) setActiveCategories(res.categories);

          setMessages((p) => [...p, {
            role: "bot",
            content: res.reply || `${matchedCat.name} — ${prefetchedItems.length || res.items?.length || 0} items`,
            items: res.items && res.items.length > 0 ? res.items : (prefetchedItems.length > 0 ? prefetchedItems : null),
          }]);
          setStatus("Ready.");
          return;
        } catch (err) {
          console.error('[CategoryMatch] ❌ Failed:', err);
        }
      }
    }


    try {
      const textToSend = fromVoice ? cleanedText : text.trim();
      console.log(`%c[Backend] 📤 process_message("${textToSend}")`, 'color: #bb88ff; font-weight: bold');
      const res = await sendMessage(token, buildChatPayload(textToSend));
      console.log(`%c[Backend] 📥 Reply: "${res.reply?.substring(0, 80)}..." | Categories: ${res.categories?.length || 0} | Items: ${res.items?.length || 0}`, 'color: #bb88ff', { categories: res.categories, items: res.items?.map(i => i.name) });
      setSessionId(res.session_id);

      // ── Handle Client Actions from Backend LLM Router ──
      if (res.client_action === "ROUTE_MULTI_ORDER") {
        if (!token) {
          setMessages((p) => [...p, { role: "bot", content: "Please sign in to place a multi-restaurant order." }]);
          setStatus("Ready.");
          if (fromVoice && voiceModeRef.current) voiceSpeakRef.current("Please sign in first to place orders.", true);
          return;
        }
        setSelectedRestaurant(null);
        setActiveCategories([]);
        setActiveCategoryName(null);
        setCurrentItems([]);
        setStatus("Processing multi-order...");
        try {
          const result = await multiOrder(token, res.client_query || textToSend); // fall back to raw input if missing
          setMessages((p) => {
            const cleaned = p.filter(m => !(m.role === "bot" && /^Welcome to\b/i.test(m.content)));
            return [...cleaned, { role: "bot", content: result.summary_text || "Order processed!" }];
          });
          setStatus("Ready.");
          if (result.added && result.added.length > 0) {
            try { fetchCart(token).then(setCartData).catch(() => { }); } catch (e) { /* ignore */ }
            setShowCartPanel(true);
          }
          if (fromVoice && voiceModeRef.current) voiceSpeakRef.current(result.voice_prompt || "Order processed.", true);
        } catch (err) {
          if (err.status === 401) {
            setToken(null); setMessages((p) => [...p, { role: "bot", content: "Session expired. Please sign in again." }]);
          } else {
            setMessages((p) => [...p, { role: "bot", content: "Sorry, I had trouble processing that multi-order. Try again!" }]);
          }
          setStatus("Ready.");
          if (fromVoice && voiceModeRef.current) voiceSpeakRef.current("Sorry, I couldn't process that order.", true);
        }
        return;
      }

      if (res.client_action === "ROUTE_MEAL_PLAN") {
        try {
          const data = await generateMealPlan(res.client_query || textToSend);
          if (data.days && data.days.length > 0) {
            setMessages((p) => [...p, { role: "bot", content: `__MEAL_PLAN__`, mealPlan: data }]);
            setStatus("Ready.");
            if (fromVoice && voiceModeRef.current) voiceSpeakRef.current("Here's your meal plan! Say another request or say 'done'.", true);
            return;
          }
        } catch { }
        setMessages((p) => [...p, { role: "bot", content: "Sorry, I had trouble generating a meal plan." }]);
        setStatus("Ready.");
        if (fromVoice && voiceModeRef.current) voiceSpeakRef.current("Sorry, I couldn't generate a meal plan.", true);
        return;
      }

      if (res.client_action === "ROUTE_PRICE_COMPARE") {
        try {
          const data = await searchByIntent(res.client_query || textToSend);
          if (data.results && data.results.length > 0) {
            const count = data.results.length;
            setMessages((p) => [...p, { role: "bot", content: `__PRICE_COMPARE__`, priceCompare: data }]);
            setStatus("Ready.");
            if (fromVoice && voiceModeRef.current) {
              voiceSpeakRef.current(`Found ${count} options. Which one?`, true);
            }
            return;
          }
          setMessages((p) => [...p, { role: "bot", content: "I couldn't find anything matching that." }]);
          setStatus("Ready.");
          if (fromVoice && voiceModeRef.current) voiceSpeakRef.current("I couldn't find anything.", true);
          return;
        } catch {
          setMessages((p) => [...p, { role: "bot", content: "Sorry, I had trouble processing that search." }]);
          setStatus("Ready.");
          if (fromVoice && voiceModeRef.current) voiceSpeakRef.current("Network issue, try again.", true);
          return;
        }
      }

      setMessages((p) => [...p, {
        role: "bot", content: res.reply,
        categories: res.categories || null,
        items: res.items || null,
      }]);
      if (res.categories && res.categories.length > 0) {
        // Only update categories for responses without items (restaurant selection)
        // Category-click responses include items — don't overwrite the sticky category bar
        if (!res.items || res.items.length === 0) {
          setActiveCategories(res.categories);
          setActiveCategoryName(null);
          setCurrentItems([]);
        }
      }
      if (res.items && res.items.length > 0) {
        setCurrentItems(res.items);
        // For category: commands, don't overwrite activeCategoryName
        // (handleCategoryClick already set it to the actual category name)
        if (!textToSend.startsWith('category:')) {
          setActiveCategoryName(text.trim());
        }
      }
      if (res.cart_summary) setCartData(res.cart_summary);
      if (text.trim().startsWith("add:")) {
        setTimeout(() => { fetchCart(token).then(setCartData).catch(() => { }); }, 300);
      }

      // Update selectedRestaurant from backend response (for voice-driven restaurant switching)
      if (res.restaurant_id && (!selectedRestaurant || selectedRestaurant.id !== res.restaurant_id)) {
        const matchedRest = restaurants.find(r => r.id === res.restaurant_id);
        if (matchedRest) setSelectedRestaurant(matchedRest);
      }

      // Voice mode: use voice_prompt from backend (fast, no extra API call)
      if (fromVoice && voiceModeRef.current) {
        const voiceReply = res.voice_prompt || res.reply;
        if (res.reply.toLowerCase().includes("submitted") || res.reply.toLowerCase().includes("placed")) {
          console.log('%c[TTS] 🔊 Speaking: "Order placed! Thank you!"', 'color: #ff88ff; font-weight: bold');
          voiceSpeakRef.current("Order placed! Thank you!", false);
          setTimeout(() => {
            voiceModeRef.current = false;
            setVoiceMode(false); setVoiceState("idle");
          }, 2000);
        } else {
          console.log(`%c[TTS] 🔊 Speaking: "${voiceReply?.substring(0, 80)}..."`, 'color: #ff88ff; font-weight: bold');
          // Speak the voice_prompt and auto-listen after
          voiceSpeakRef.current(voiceReply, true);
        }
      }

      setStatus("Ready.");
    } catch (err) {
      setVoiceState("idle");
      if (err.status === 401) {
        localStorage.removeItem("token"); setToken(null);
        setStatus("Session expired. Please log in again.");
      } else { setStatus(err.message || "Failed"); }
      if (fromVoice && voiceModeRef.current) {
        voiceSpeakRef.current("Error. Try again.", true);
      }
    }
  };
  // Keep ref in sync so voice callbacks (stale closures) always call the latest doSend
  doSendRef.current = doSend;

  const handleSend = (e) => { e.preventDefault(); doSend(messageText); };
  const handleCategoryClick = async (cat) => {
    setActiveCategoryName(cat.name);
    setStatus("Loading...");
    try {
      // Use public REST endpoint — no auth required
      const apiBase = import.meta.env.VITE_API_BASE || "http://localhost:8000";
      const res = await fetch(`${apiBase}/categories/${cat.id}/items`);
      if (res.ok) {
        const items = await res.json();
        setCurrentItems(items);
        setMessages((p) => [...p, {
          role: "bot",
          content: items.length > 0
            ? `${cat.name} — ${items.length} item${items.length !== 1 ? 's' : ''}`
            : `${cat.name} — no items available`,
          items: items.length > 0 ? items : null,
        }]);
        setStatus("Ready.");
        // Also sync with chat session if authenticated (so add-to-cart works)
        if (token) {
          sendMessage(token, buildChatPayload(`category:${cat.id}`))
            .then(r => { if (r.session_id) setSessionId(r.session_id); })
            .catch(() => { });
        }
        return;
      }
    } catch (err) {
      console.error("[CategoryClick] REST fetch failed:", err);
    }
    // Fallback: use chat endpoint if REST fails and user is authenticated
    if (token) {
      doSend(`category:${cat.id}`);
    } else {
      setMessages((p) => [...p, { role: "bot", content: "Please sign in to browse the full menu." }]);
      setStatus("Ready.");
    }
  };
  const handleAddItem = (item) => {
    setAddedItemId(item.id);
    setTimeout(() => setAddedItemId(null), 500);
    doSend(`add:${item.id}:1`);
  };

  // ===================== RESTAURANT SELECTION =====================

  const selectRestaurant = async (r) => {
    setSelectedRestaurant(r);
    setShowSuggestions(false);
    setTab("chat");
    setActiveCategories([]);
    setActiveCategoryName(null);
    setCurrentItems([]);
    setStatus("Loading menu...");

    const apiBase = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

    // Fire both in parallel: fast categories REST + session setup via process_message
    const catPromise = fetch(`${apiBase}/restaurants/${r.id}/categories`)
      .then(res => res.ok ? res.json() : [])
      .catch(() => []);

    const sessionPromise = token
      ? sendMessage(token, buildChatPayload(`#${r.slug}`)).catch(() => null)
      : Promise.resolve(null);

    // Categories come back first (simple DB query)
    const cats = await catPromise;
    if (cats && cats.length > 0) {
      setActiveCategories(cats);
    }

    // Session setup finishes second — use it for session ID and welcome message only
    const sessionRes = await sessionPromise;
    if (sessionRes) {
      if (sessionRes.session_id) setSessionId(sessionRes.session_id);
      // Show welcome message but DON'T override categories (pre-fetch is authoritative)
      const welcomeText = sessionRes.reply || `Welcome to **${r.name}**! Pick a category or just tell me what you want.`;
      setMessages((p) => [...p, { role: "bot", content: welcomeText }]);
      // If pre-fetch returned nothing, fall back to backend categories
      if ((!cats || cats.length === 0) && sessionRes.categories && sessionRes.categories.length > 0) {
        setActiveCategories(sessionRes.categories);
      }
    } else {
      // No token or backend error — still show categories from pre-fetch
      setMessages((p) => [...p, { role: "bot", content: `Welcome to **${r.name}**! Pick a category or just tell me what you want.` }]);
    }
    setStatus("Ready.");
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    setMessageText(val);
    if (val.startsWith("#")) {
      const q = val.slice(1).toLowerCase();
      const partnered = restaurants.filter(
        (r) => r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q)
      ).map((r) => ({ ...r, partnered: true }));
      const nearby = nearbyPlaces.filter(
        (r) => r.name.toLowerCase().includes(q)
      ).map((r) => ({ ...r, slug: r.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), partnered: false }));
      const combined = [...partnered, ...nearby];
      setFilteredRestaurants(combined);
      setShowSuggestions(combined.length > 0);
      setSelectedIndex(0);
    } else { setShowSuggestions(false); }
  };

  const handleKeyDown = (e) => {
    if (!showSuggestions) { if (e.key === "Enter") { e.preventDefault(); handleSend(e); } return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex((i) => (i + 1) % filteredRestaurants.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex((i) => (i - 1 + filteredRestaurants.length) % filteredRestaurants.length); }
    else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); if (filteredRestaurants[selectedIndex]) selectRestaurant(filteredRestaurants[selectedIndex]); }
    else if (e.key === "Escape") setShowSuggestions(false);
  };

  // ===================== AUTH =====================

  const handleAuth = async (e) => {
    e.preventDefault(); setStatus("Signing in...");
    try {
      const res = mode === "login" ? await login({ email, password }) : await register({ email, password });
      setToken(res.access_token);
      const role = res.role || "customer";
      setUserRole(role); localStorage.setItem("userRole", role);
      if (role === "owner" || role === "admin") {
        setShowOwnerPortal(true);
      } else {
        // Redirect customers to home and sync location
        setTab("home");
        // Use saved zipcode or detect GPS location
        const savedZip = localStorage.getItem("zipcode");
        if (savedZip) {
          lookupZipcodeAuto(savedZip);
        } else if (userLat != null && userLng != null) {
          fetchRestaurantsData(userLat, userLng, radius);
        } else if (navigator.geolocation) {
          setLocating(true); setLocationLabel("Detecting...");
          navigator.geolocation.getCurrentPosition(
            async (pos) => {
              const lat = pos.coords.latitude, lng = pos.coords.longitude;
              setUserLat(lat); setUserLng(lng);
              try {
                const geoRes = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`);
                const geo = await geoRes.json();
                setLocationLabel(`${geo.city || geo.locality || ""}, ${geo.principalSubdivisionCode || geo.countryCode || ""}`);
              } catch { setLocationLabel(`${lat.toFixed(2)}, ${lng.toFixed(2)}`); }
              await fetchRestaurantsData(lat, lng, radius);
              setLocating(false);
            },
            () => { setLocationLabel(""); fetchRestaurantsData(null, null, radius); setLocating(false); },
            { timeout: 5000 }
          );
        } else {
          fetchRestaurantsData(null, null, radius);
        }
      }
      setStatus("Ready.");
    } catch (err) { setStatus(err.message || "Auth failed."); }
  };

  const handleLogout = () => {
    setToken(""); setSessionId(null); setMessages([welcomeMsg]);
    setCartData(null); setShowCartPanel(false); localStorage.removeItem("token");
    setActiveCategories([]); setActiveCategoryName(null); setCurrentItems([]);
    setUserRole("customer"); localStorage.removeItem("userRole"); setShowOwnerPortal(false);
    setSelectedRestaurant(null); setTab("home");
  };

  // ===================== HELPERS =====================

  const renderContent = (text) => {
    return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
      p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : p
    );
  };

  const cartItemCount = cartData?.restaurants?.reduce((t, g) => t + g.items.reduce((s, i) => s + i.quantity, 0), 0) || 0;
  const cartTotal = cartData?.grand_total_cents ? (cartData.grand_total_cents / 100).toFixed(2) : "0.00";

  const activeOrders = myOrders.filter(o => !['completed', 'rejected'].includes(o.status) || (Date.now() - new Date(o.created_at).getTime() < 3600000));
  const completedOrders = myOrders.filter(o => ['completed'].includes(o.status) && (Date.now() - new Date(o.created_at).getTime() >= 3600000));

  // ===================== OWNER PORTAL =====================

  if (showOwnerPortal) {
    return (
      <OwnerPortal
        token={token}
        onBack={() => { if (userRole === "owner") handleLogout(); else setShowOwnerPortal(false); }}
        onTokenUpdate={(t) => { setToken(t); setUserRole("owner"); localStorage.setItem("userRole", "owner"); setShowOwnerPortal(true); }}
      />
    );
  }

  // ===================== RENDER =====================

  return (
    <div className="app-shell">
      <div className="app-content">
        {/* Payment Toast */}
        <AnimatePresence>
          {paymentToast && (
            <motion.div
              className={`payment-toast ${paymentToast.type}`}
              initial={{ y: -60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -60, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              onClick={() => setPaymentToast(null)}
              style={{
                position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
                padding: "14px 20px", textAlign: "center", fontWeight: 600, fontSize: "15px",
                cursor: "pointer",
                background: paymentToast.type === "success"
                  ? "linear-gradient(135deg, #00c853, #00e676)"
                  : "linear-gradient(135deg, #ff9800, #ffc107)",
                color: "#fff",
                boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
              }}
            >
              {paymentToast.message}
            </motion.div>
          )}
        </AnimatePresence>
        {/* ====== HOME TAB ====== */}
        {tab === "home" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
            {/* Location Bar */}
            <div className="location-bar">
              <span className="loc-icon">📍</span>
              <div className="loc-info">
                <span className="loc-label">{locating ? "Detecting..." : locationLabel || "Set location"}</span>
                {zipcode && <span className="loc-sub">ZIP: {zipcode}</span>}
              </div>
              <div className="loc-actions">
                <input className="loc-zip-input" type="text" placeholder="Zip" value={zipcode}
                  onChange={(e) => handleZipcodeChange(e.target.value)} maxLength={5} />
                <button className="loc-gps-btn" onClick={useMyLocation} disabled={locating} title="Use GPS">🎯</button>
                <select className="loc-radius-select" value={radius} onChange={(e) => handleRadiusChange(Number(e.target.value))}>
                  {RADIUS_OPTIONS.map((r) => <option key={r} value={r}>{r} mi</option>)}
                </select>
              </div>
            </div>

            {/* Search */}
            <div className="search-bar">
              <span className="search-icon">🔍</span>
              <input placeholder="Search restaurants or cuisines..."
                value={citySearch} onChange={(e) => handleCitySearchChange(e.target.value)}
                onFocus={() => { if (citySuggestions.length > 0) setShowCitySuggestions(true); }}
                onBlur={() => setTimeout(() => setShowCitySuggestions(false), 200)}
              />
              {showCitySuggestions && citySuggestions.length > 0 && (
                <div className="city-suggestions">
                  {citySuggestions.map((s, i) => (
                    <div key={i} className="city-suggestion-item" onMouseDown={() => selectCity(s)}>
                      <span>{s.city}, {s.state}</span>
                      {s.zipcode && <span className="city-suggestion-zip">{s.zipcode}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Featured Restaurant */}
            {restaurants.length > 0 && (
              <motion.div className="featured-card" onClick={() => {
                if (!token) { setTab("profile"); return; }
                selectRestaurant(restaurants[0]);
              }}
                whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }} style={{ cursor: 'pointer' }}>
                {(() => {
                  const heroImg = getRestaurantImage(restaurants[0].name);
                  return heroImg ? (
                    <img src={heroImg} alt={restaurants[0].name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', background: `linear-gradient(135deg, ${CARD_GRADIENTS[0][0]}, ${CARD_GRADIENTS[0][1]})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '4rem' }}>
                      {getFoodEmoji(restaurants[0].name)}
                    </div>
                  );
                })()}
                <div className="featured-overlay">
                  <span className="featured-badge">PARTNERED</span>
                  <div className="featured-name">{restaurants[0].name}</div>
                  <div className="featured-sub">
                    {restaurants[0].city && `${restaurants[0].city} · `}
                    {restaurants[0].distance_miles != null && `${restaurants[0].distance_miles} mi away`}
                  </div>
                </div>
              </motion.div>
            )}

            {/* Budget Optimizer Floating Button */}
            <motion.button
              className="optimizer-fab"
              onClick={() => { if (!token) { setTab("profile"); return; } setShowOptimizer(true); }}
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.95 }}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
            >
              💰 Budget Optimizer
            </motion.button>

            {/* Hero Video - See AI in Action */}
            <motion.div className="hero-video-section"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              <div className="hero-video-header">
                <span className="hero-video-badge">🎬 NEW</span>
                <span className="hero-video-title">See AI in Action</span>
                <span className="hero-video-sub">Watch how RestaurantAI finds your perfect meal</span>
              </div>
              <div className="hero-video-wrapper">
                <video
                  className="hero-video"
                  src="/hero-video.mp4"
                  autoPlay
                  muted
                  loop
                  playsInline
                  onClick={(e) => {
                    const v = e.currentTarget;
                    if (v.paused) { v.play(); } else { v.pause(); }
                  }}
                />
                <div className="hero-video-play-hint">Tap to play/pause</div>
              </div>
            </motion.div>

            {/* All Restaurants Grid */}
            {restaurants.length > 0 && (
              <>
                <div className="section-header">
                  <span className="section-title">🟢 Order Now ({restaurants.length})</span>
                </div>
                <div className="restaurant-grid">
                  {restaurants.map((r, idx) => {
                    const grad = CARD_GRADIENTS[idx % CARD_GRADIENTS.length];
                    const rImg = getRestaurantImage(r.name);
                    return (
                      <motion.div key={r.id} className="restaurant-card-v"
                        onClick={() => {
                          if (!token) { setTab("profile"); return; }
                          selectRestaurant(r);
                        }}
                        initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.04 }}>
                        <div className="restaurant-card-v-img" style={rImg ? {} : { background: `linear-gradient(135deg, ${grad[0]}, ${grad[1]})` }}>
                          {rImg ? (
                            <img src={rImg} alt={r.name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
                          ) : (
                            <span className="restaurant-card-v-emoji">{getFoodEmoji(r.name)}</span>
                          )}
                        </div>
                        <div className="restaurant-card-v-body">
                          <div className="restaurant-card-v-name">{r.name}</div>
                          <div className="restaurant-card-v-meta">
                            {r.distance_miles != null && <span>{r.distance_miles} mi</span>}
                            {r.city && <span>· {r.city}</span>}
                          </div>
                          <span className="order-chip">{token ? 'Order' : 'Sign in'}</span>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </>
            )}

            {/* Nearby */}
            {(nearbyPlaces.length > 0 || (!locating && userLat)) && (
              <>
                <div className="section-header" style={{ marginTop: 16 }}>
                  <span className="section-title">📍 Nearby Restaurants</span>
                </div>
                <div className="nearby-list">
                  {nearbyPlaces.length > 0 ? (
                    nearbyPlaces.slice(0, 8).map((p, i) => (
                      <motion.div key={`nearby-${i}`} className="nearby-item"
                        initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05 }}>
                        <div className="nearby-item-img" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem' }}>
                          {getFoodEmoji(p.name, p.cuisine || "")}
                        </div>
                        <div className="nearby-item-info">
                          <div className="nearby-item-name">{p.name}</div>
                          <div className="nearby-item-meta">
                            {p.cuisine && <span className="cuisine-tag">{p.cuisine}</span>}
                            {p.address && ` · ${p.address}`}
                          </div>
                        </div>
                        <span className="nearby-item-distance">{p.distance_miles} mi</span>
                      </motion.div>
                    ))
                  ) : (
                    <div className="menu-empty">
                      <div className="menu-empty-emoji">⏳</div>
                      <div className="menu-empty-text">Searching nearby restaurants...</div>
                    </div>
                  )}
                </div>
              </>
            )}
          </motion.div>
        )}

        {/* ====== CHAT + MENU TAB ====== */}
        {tab === "chat" && (
          <div className="chat-page">
            {!token ? (
              <div className="menu-empty" style={{ paddingTop: 60 }}>
                <div className="menu-empty-emoji">🔐</div>
                <div className="menu-empty-text">Sign in to start ordering</div>
                <div className="menu-empty-hint">Go to the Profile tab to log in</div>
              </div>
            ) : (
              <>
                {/* Chat Header */}
                <div className="chat-header">
                  <div className="chat-header-left">
                    {selectedRestaurant && (
                      <button className="chat-header-back" onClick={() => { setSelectedRestaurant(null); setActiveCategories([]); setCurrentItems([]); setTab("home"); }}>←</button>
                    )}
                    <div>
                      <div className="chat-header-title">{selectedRestaurant?.name || "RestaurantAI"}</div>
                      <div className="chat-header-status">{selectedRestaurant ? "● Online" : status}</div>
                    </div>
                  </div>
                  {cartData && cartData.restaurants && cartData.restaurants.length > 0 && (
                    <button className="chat-cart-btn" onClick={() => setShowCartPanel((v) => !v)}>
                      🛒 ${cartTotal}
                      {cartItemCount > 1 && <span className="cart-count">{cartItemCount}</span>}
                    </button>
                  )}
                </div>

                {/* Category Pills */}
                {activeCategories.length > 0 && (
                  <div className="category-pills">
                    {activeCategories.map((cat) => {
                      const catImg = getFoodItemImage(cat.name);
                      return (
                        <button key={cat.id}
                          className={`cat-pill ${activeCategoryName === cat.name ? "active" : ""}`}
                          onClick={() => handleCategoryClick(cat)}>
                          {catImg ? (
                            <img src={catImg} alt="" className="cat-thumb" />
                          ) : (
                            <span className="cat-emoji">{getFoodEmoji(cat.name)}</span>
                          )}
                          {cat.name}
                          <span className="cat-count">{cat.item_count}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Menu Items */}
                <div className="menu-area">
                  {currentItems.length > 0 ? (
                    currentItems.map((item, ii) => (
                      <motion.div key={item.id} className="menu-item"
                        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: ii * 0.04 }}>
                        <div className="menu-item-img">
                          {(() => {
                            const itemImg = getFoodItemImage(item.name, activeCategoryName || '');
                            return itemImg ? (
                              <img src={itemImg} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
                            ) : getFoodEmoji(item.name);
                          })()}
                        </div>
                        <div className="menu-item-info">
                          <div className="menu-item-name">{item.name}</div>
                          {item.description && <div className="menu-item-desc">{item.description}</div>}
                          <div className="menu-item-price">${(item.price_cents / 100).toFixed(2)}</div>
                        </div>
                        <motion.button
                          className={`menu-add-btn ${addedItemId === item.id ? 'added' : ''}`}
                          onClick={() => handleAddItem(item)}
                          whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.85 }}>
                          +
                        </motion.button>
                      </motion.div>
                    ))
                  ) : activeCategories.length > 0 ? (
                    <div className="menu-empty">
                      <div className="menu-empty-emoji">👆</div>
                      <div className="menu-empty-text">Tap a category above to see items</div>
                    </div>
                  ) : selectedRestaurant ? (
                    <div className="menu-empty">
                      <div className="menu-empty-emoji">⏳</div>
                      <div className="menu-empty-text">Loading menu...</div>
                    </div>
                  ) : (
                    <div className="menu-empty">
                      <div className="menu-empty-emoji">🍽️</div>
                      <div className="menu-empty-text">Pick a restaurant from the Home tab</div>
                      <div className="menu-empty-hint">Or type # to search restaurants below</div>
                    </div>
                  )}
                </div>

                {/* AI Chat Strip */}
                <div className="ai-strip">
                  {/* Show latest bot message */}
                  {messages.length > 0 && (() => {
                    const lastBot = [...messages].reverse().find(m => m.role === "bot");
                    if (!lastBot) return null;
                    // Price Comparison Card
                    if (lastBot.priceCompare) {
                      const { query, results, best_value } = lastBot.priceCompare;
                      return (
                        <div className="price-compare-card">
                          <div className="compare-header">
                            <span className="compare-icon">🔍</span>
                            <span className="compare-title">Price Comparison: <b>{query}</b></span>
                          </div>
                          <div className="compare-results">
                            {results.slice(0, 8).map((r, i) => (
                              <div key={i} className={`compare-row ${best_value && r.price_cents === best_value.price_cents && r.restaurant_name === best_value.restaurant_name ? 'best-value' : ''}`}>
                                <div className="compare-rank">{i === 0 ? '🏆' : `#${i + 1}`}</div>
                                <div className="compare-info">
                                  <div className="compare-item-name">{r.item_name}</div>
                                  <div className="compare-restaurant">{r.restaurant_name}{r.city ? ` · ${r.city}` : ''}{r.rating ? ` ⭐${r.rating}` : ''}</div>
                                </div>
                                <div className="compare-price">${(r.price_cents / 100).toFixed(2)}</div>
                                <button className="compare-order-btn" onClick={async (e) => {
                                  const btn = e.currentTarget;
                                  if (!token) { setStatus("Please log in to order"); return; }
                                  try {
                                    btn.textContent = "…";
                                    await addComboToCart(token, r.restaurant_id, [{ item_id: r.item_id, quantity: 1 }]);
                                    const cartRes = await fetchCart(token);
                                    setCartData(cartRes);
                                    btn.textContent = "✓ Added";
                                    btn.style.background = "var(--success)";
                                    setTimeout(() => { btn.textContent = "Order"; btn.style.background = ""; }, 1500);
                                  } catch (err) {
                                    btn.textContent = "Order";
                                    setStatus(err.message || "Failed to add");
                                  }
                                }}>Order</button>
                              </div>
                            ))}
                          </div>
                          {best_value && <div className="compare-footer">🏆 Best Value: <b>{best_value.restaurant_name}</b> — ${(best_value.price_cents / 100).toFixed(2)}</div>}
                        </div>
                      );
                    }
                    // Meal Plan Card
                    if (lastBot.mealPlan) {
                      const plan = lastBot.mealPlan;
                      const DAY_SHORT = { Monday: "MON", Tuesday: "TUE", Wednesday: "WED", Thursday: "THU", Friday: "FRI", Saturday: "SAT", Sunday: "SUN" };
                      const DAY_COLORS = ["#f59e0b", "#8b5cf6", "#3b82f6", "#ec4899", "#22c55e", "#06b6d4", "#ef4444"];
                      return (
                        <div className="mp-card">
                          {/* Header */}
                          <div className="mp-header">
                            <div className="mp-title-row">
                              <span className="mp-icon">🍽️</span>
                              <span className="mp-title">Your {plan.days.length}-Day Meal Plan</span>
                            </div>
                            <div className="mp-stats">
                              <span className="mp-stat">💰 ${(plan.total_cents / 100).toFixed(2)}</span>
                              <span className="mp-stat mp-saved">✅ ${(plan.savings_cents / 100).toFixed(2)} saved</span>
                              <span className="mp-stat">{new Set(plan.days.map(d => d.restaurant_name)).size} restaurants</span>
                            </div>
                          </div>

                          {/* Days */}
                          <div className="mp-days">
                            {plan.days.map((d, i) => (
                              <div key={i} className="mp-row">
                                <div className="mp-day-pill" style={{ background: DAY_COLORS[i % 7] }}>
                                  {DAY_SHORT[d.day] || d.day.slice(0, 3).toUpperCase()}
                                </div>
                                <div className="mp-meal-info">
                                  <div className="mp-meal-name">{d.item_name}</div>
                                  <div className="mp-meal-rest">{d.restaurant_name}</div>
                                </div>
                                <div className="mp-meal-right">
                                  <div className="mp-meal-price">${(d.price_cents / 100).toFixed(2)}</div>
                                  <div className="mp-meal-btns">
                                    <button className="mp-btn-order" onClick={async (e) => {
                                      const btn = e.currentTarget;
                                      if (!token) { setStatus("Please log in to order"); return; }
                                      try {
                                        btn.textContent = "…";
                                        await addComboToCart(token, d.restaurant_id, [{ item_id: d.item_id, quantity: 1 }]);
                                        const cartRes = await fetchCart(token);
                                        setCartData(cartRes);
                                        btn.textContent = "✓";
                                        btn.style.background = "var(--success)";
                                        setTimeout(() => { btn.textContent = "Order"; btn.style.background = ""; }, 1500);
                                      } catch (err) {
                                        btn.textContent = "Order";
                                        setStatus(err.message || "Failed");
                                      }
                                    }}>Order</button>
                                    <button className="mp-btn-swap" onClick={async (e) => {
                                      const btn = e.currentTarget;
                                      try {
                                        btn.textContent = "…";
                                        const newMeal = await swapMeal({
                                          text: "",
                                          day_index: i,
                                          current_item_id: d.item_id,
                                          budget_remaining_cents: plan.savings_cents + d.price_cents,
                                        });
                                        setMessages((prev) => prev.map((msg) => {
                                          if (msg.mealPlan) {
                                            const newDays = [...msg.mealPlan.days];
                                            const oldPrice = newDays[i].price_cents;
                                            newDays[i] = newMeal;
                                            const newTotal = msg.mealPlan.total_cents - oldPrice + newMeal.price_cents;
                                            return {
                                              ...msg,
                                              mealPlan: { ...msg.mealPlan, days: newDays, total_cents: newTotal, savings_cents: msg.mealPlan.budget_cents - newTotal },
                                            };
                                          }
                                          return msg;
                                        }));
                                        btn.textContent = "🔄";
                                        setTimeout(() => { btn.textContent = "↻"; }, 1000);
                                      } catch (err) {
                                        btn.textContent = "↻";
                                        setStatus(err.message || "No alternatives");
                                      }
                                    }}>↻</button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>

                          {/* Footer */}
                          <div className="mp-footer">
                            <div className="mp-footer-left">
                              <div className="mp-footer-total">${(plan.total_cents / 100).toFixed(2)}</div>
                              <div className="mp-footer-savings">You saved ${(plan.savings_cents / 100).toFixed(2)} ✨</div>
                            </div>
                            <button className="mp-order-all" onClick={async (e) => {
                              const btn = e.currentTarget;
                              if (!token) { setStatus("Please log in to order"); return; }
                              try {
                                btn.textContent = "Ordering…";
                                for (const d of plan.days) {
                                  await addComboToCart(token, d.restaurant_id, [{ item_id: d.item_id, quantity: 1 }]);
                                }
                                const cartRes = await fetchCart(token);
                                setCartData(cartRes);
                                btn.textContent = "✓ All Added";
                                btn.style.background = "var(--success)";
                                setTimeout(() => { btn.textContent = "Order Full Plan"; btn.style.background = ""; }, 2000);
                              } catch (err) {
                                btn.textContent = "Order Full Plan";
                                setStatus(err.message || "Failed");
                              }
                            }}>Order Full Plan</button>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div className="ai-message">
                        <div className="ai-avatar">✨</div>
                        <div className="ai-bubble">{renderContent(lastBot.content)}</div>
                      </div>
                    );
                  })()}

                  {/* Compact voice status bar (non-blocking) */}
                  {voiceMode && (
                    <div className="voice-status-bar">
                      <div className={`voice-dot ${voiceState}`} />
                      <span className="voice-status-text">
                        {voiceState === "speaking" ? "🔊 Speaking..." : voiceState === "listening" ? "🎙️ Listening..." : voiceState === "processing" ? "⏳ Processing..." : "🎤 Voice On"}
                      </span>
                      {liveTranscript && <span className="voice-live" style={{ color: "#aef", fontStyle: "italic", marginLeft: 6, fontSize: "0.85em" }}>{liveTranscript}</span>}
                      <button className="voice-end-btn" onClick={toggleVoiceMode}>✕</button>
                    </div>
                  )}

                  {/* Input */}
                  <form onSubmit={handleSend} className="ai-chat-input-row" style={{ position: 'relative' }}>
                    <input ref={inputRef} className="ai-chat-input" value={messageText}
                      onChange={handleInputChange} onKeyDown={handleKeyDown}
                      placeholder={voiceMode ? "Voice active — speak or type..." : "Type # for restaurants, or ask anything..."} />
                    <button type="button" className={`mic-btn ${voiceMode ? "voice-active" : ""}`} onClick={toggleVoiceMode}
                      title={voiceMode ? "End voice mode" : "Start voice mode"}>
                      {voiceMode ? "🔴" : "🎤"}
                    </button>
                    <button type="submit" className="send-btn">➤</button>
                    {/* Restaurant suggestions */}
                    {showSuggestions && (
                      <div className="suggestions">
                        {filteredRestaurants.map((r, i) => (
                          <div key={r.slug + "-" + i}
                            className={`suggestion-item ${i === selectedIndex ? "selected" : ""}`}
                            onMouseDown={(e) => { e.preventDefault(); selectRestaurant(r); }}
                            onMouseEnter={() => setSelectedIndex(i)}>
                            <div>
                              <div className="suggestion-name">
                                {r.partnered && <span className="suggestion-badge">✓</span>}
                                {r.name}
                              </div>
                              {r.city && <div className="suggestion-meta">{r.city}{r.distance_miles != null ? ` · ${r.distance_miles} mi` : ''}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </form>
                </div>
              </>
            )}
          </div>
        )}

        {/* ====== ORDERS TAB ====== */}
        {tab === "orders" && (
          <motion.div className="orders-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="orders-title">Your Orders</div>

            {!token ? (
              <div className="orders-empty">
                <div className="orders-empty-emoji">🔐</div>
                <div className="menu-empty-text">Sign in to see your orders</div>
              </div>
            ) : (
              <>
                <div className="orders-tabs">
                  <button className={`orders-tab ${ordersTab === "current" ? "active" : ""}`} onClick={() => setOrdersTab("current")}>Current</button>
                  <button className={`orders-tab ${ordersTab === "history" ? "active" : ""}`} onClick={() => setOrdersTab("history")}>History</button>
                </div>

                {ordersTab === "current" && (
                  <>
                    {activeOrders.length === 0 ? (
                      <div className="orders-empty">
                        <div className="orders-empty-emoji">📦</div>
                        <div className="menu-empty-text">No active orders</div>
                        <div className="menu-empty-hint">Go to Home tab and pick a restaurant to start ordering!</div>
                      </div>
                    ) : (
                      <>
                        <div className="orders-section-title">In Progress</div>
                        {activeOrders.map((order) => {
                          const steps = ['confirmed', 'accepted', 'preparing', 'ready', 'completed'];
                          const stepLabels = { confirmed: '📋 Ordered', accepted: '✅ Accepted', preparing: '🍳 Preparing', ready: '📦 Ready', completed: '🎉 Picked Up' };
                          const isRejected = order.status === 'rejected';
                          const currentStep = isRejected ? -1 : steps.indexOf(order.status);
                          const etaMins = order.estimated_ready_at ? Math.max(0, Math.round((new Date(order.estimated_ready_at) - Date.now()) / 60000)) : null;
                          const queuePos = order.queue_position || 0;
                          return (
                            <motion.div key={order.id} className={`order-card ${isRejected ? 'rejected' : ''}`}
                              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                              <div className="order-card-header">
                                <div>
                                  <div className="order-restaurant-name">🍽️ {order.restaurant_name}</div>
                                  <div className="order-time">
                                    {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    {order.order_type === 'dine_in' && <span className="dine-in-badge">🪑 Table {order.table_number}</span>}
                                    {order.order_type === 'pickup' && <span className="pickup-badge">📦 Pickup</span>}
                                  </div>
                                </div>
                                <div className="order-price">${(order.total_cents / 100).toFixed(2)}</div>
                              </div>

                              {/* ETA & Queue Badge */}
                              {!isRejected && (etaMins !== null || queuePos > 0) && (
                                <div className="order-eta-bar">
                                  {etaMins !== null && <div className="eta-countdown">⏱️ Ready in ~{etaMins} min</div>}
                                  {queuePos > 0 && <div className="queue-badge">{queuePos === 1 ? '🔥 You\'re next!' : `📊 ${queuePos - 1} order${queuePos - 1 > 1 ? 's' : ''} ahead`}</div>}
                                </div>
                              )}

                              <div className="order-items-summary">
                                {order.items.map((it) => `${it.quantity}x ${it.name}`).join(', ')}
                              </div>
                              {isRejected ? (
                                <div className="order-rejected-badge">❌ Order Rejected</div>
                              ) : (
                                <div className="progress-tracker">
                                  {steps.map((s, i) => (
                                    <div key={s} className={`progress-step ${i <= currentStep ? 'active' : ''} ${i === currentStep ? 'current' : ''}`}>
                                      <div className="progress-dot" />
                                      <span className="progress-label">{stepLabels[s] || s}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </motion.div>
                          );
                        })}
                      </>
                    )}
                  </>
                )}

                {ordersTab === "history" && (
                  <>
                    {completedOrders.length === 0 ? (
                      <div className="orders-empty">
                        <div className="orders-empty-emoji">📋</div>
                        <div className="menu-empty-text">No past orders yet</div>
                      </div>
                    ) : (
                      completedOrders.map((order) => (
                        <div key={order.id} className="recent-order">
                          <div className="recent-order-info">
                            <div className="recent-order-name">🍽️ {order.restaurant_name}</div>
                            <div className="recent-order-detail">
                              {order.items.map((it) => `${it.quantity}x ${it.name}`).join(', ')} · ${(order.total_cents / 100).toFixed(2)}
                            </div>
                          </div>
                          <span className="delivered-badge">Delivered</span>
                        </div>
                      ))
                    )}
                  </>
                )}
              </>
            )}
          </motion.div>
        )}

        {/* ====== DINE-IN TAB ====== */}
        {tab === "dine-in" && dineInMode && dineInRestaurant && (
          <motion.div className="dine-in-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="dine-in-banner">
              <div className="dine-in-banner-name">🍽️ {dineInRestaurant.restaurant_name}</div>
              <div className="dine-in-banner-table">🪑 Table {dineInTable}</div>
            </div>

            {!token ? (
              <div className="dine-in-auth">
                <div className="orders-empty-emoji">🔐</div>
                <div className="menu-empty-text">Sign in to place your dine-in order</div>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <input id="dine-in-email" placeholder="Email" className="auth-input" />
                  <input id="dine-in-pass" type="password" placeholder="Password" className="auth-input" />
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="checkout-btn" onClick={async () => {
                    const em = document.getElementById("dine-in-email")?.value;
                    const pw = document.getElementById("dine-in-pass")?.value;
                    if (!em || !pw) return;
                    try {
                      const data = await login({ email: em, password: pw });
                      setToken(data.access_token);
                    } catch {
                      try {
                        const data = await register({ email: em, password: pw });
                        setToken(data.access_token);
                      } catch (e2) { alert("Login failed: " + e2.message); }
                    }
                  }}>Sign In / Register</button>
                </div>
              </div>
            ) : dineInDone ? (
              <div className="dine-in-done">
                <div className="orders-empty-emoji">✅</div>
                <div className="menu-empty-text">Order #{dineInDone.order_id} placed!</div>
                <div className="menu-empty-hint">Your food will be served at Table {dineInTable}.</div>
                <div className="dine-in-done-total">${(dineInDone.total_cents / 100).toFixed(2)}</div>
                <button className="checkout-btn" style={{ marginTop: 12 }} onClick={() => {
                  setDineInDone(null); setDineInCart([]); setDineInCategory(null);
                }}>Order More</button>
              </div>
            ) : (
              <>
                {/* Category chips */}
                <div className="dine-in-categories">
                  {dineInRestaurant.categories.map(cat => (
                    <button key={cat.id}
                      className={`dine-in-cat-chip ${dineInCategory === cat.id ? "active" : ""}`}
                      onClick={() => setDineInCategory(dineInCategory === cat.id ? null : cat.id)}>
                      {cat.name}
                    </button>
                  ))}
                </div>

                {/* Menu items */}
                <div className="dine-in-menu">
                  {dineInRestaurant.categories
                    .filter(c => !dineInCategory || c.id === dineInCategory)
                    .map(cat => (
                      <div key={cat.id} className="dine-in-cat-section">
                        <div className="dine-in-cat-title">{cat.name}</div>
                        {cat.items.map(item => {
                          const inCart = dineInCart.find(c => c.item_id === item.id);
                          return (
                            <div key={item.id} className="dine-in-item">
                              <div className="dine-in-item-info">
                                <div className="dine-in-item-name">{getFoodEmoji(item.name, cat.name)} {item.name}</div>
                                {item.description && <div className="dine-in-item-desc">{item.description}</div>}
                                <div className="dine-in-item-price">${(item.price_cents / 100).toFixed(2)}</div>
                              </div>
                              <div className="dine-in-item-actions">
                                {inCart ? (
                                  <div className="dine-in-qty">
                                    <button onClick={() => setDineInCart(prev => {
                                      return prev.map(c => c.item_id === item.id ? { ...c, quantity: c.quantity - 1 } : c).filter(c => c.quantity > 0);
                                    })}>−</button>
                                    <span>{inCart.quantity}</span>
                                    <button onClick={() => setDineInCart(prev => prev.map(c => c.item_id === item.id ? { ...c, quantity: c.quantity + 1 } : c))}>+</button>
                                  </div>
                                ) : (
                                  <button className="dine-in-add-btn" onClick={() => setDineInCart(prev => [...prev, { item_id: item.id, quantity: 1 }])}>
                                    + Add
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                </div>

                {/* Cart footer */}
                {dineInCart.length > 0 && (
                  <div className="dine-in-footer">
                    <div className="dine-in-footer-info">
                      <span>{dineInCart.reduce((s, c) => s + c.quantity, 0)} items</span>
                      <span>${(dineInCart.reduce((s, c) => {
                        const item = dineInRestaurant.categories.flatMap(cat => cat.items).find(i => i.id === c.item_id);
                        return s + (item ? item.price_cents * c.quantity : 0);
                      }, 0) / 100).toFixed(2)}</span>
                    </div>
                    <button className="dine-in-order-btn" disabled={dineInPlacing} onClick={async () => {
                      setDineInPlacing(true);
                      try {
                        const result = await placeDineInOrder(token, dineInRestaurant.restaurant_id, dineInTable, dineInCart);
                        setDineInDone(result);
                        fetchMyOrders(token).then(setMyOrders).catch(() => { });
                      } catch (err) {
                        alert("Order failed: " + err.message);
                      }
                      setDineInPlacing(false);
                    }}>
                      {dineInPlacing ? "Placing..." : "🍽️ Place Dine-In Order"}
                    </button>
                  </div>
                )}
              </>
            )}
          </motion.div>
        )}

        {/* ====== PROFILE TAB ====== */}
        {tab === "profile" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>

            {!token ? (
              <div className="auth-page">
                <div className="auth-logo">RestaurantAI</div>
                <div className="auth-subtitle">{mode === "login" ? "Welcome back" : "Create your account"}</div>
                <form className="auth-form" onSubmit={handleAuth}>
                  <label>Email
                    <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required placeholder="you@example.com" />
                  </label>
                  <label>Password
                    <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required minLength={6} placeholder="••••••••" />
                  </label>
                  <motion.button className="auth-submit" type="submit" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}>
                    {mode === "login" ? "Sign in" : "Create account"}
                  </motion.button>
                </form>
                <button className="auth-switch" onClick={() => setMode(mode === "login" ? "register" : "login")}>
                  {mode === "login" ? "Need an account? Sign up" : "Already have an account? Sign in"}
                </button>
                <button className="auth-switch" onClick={() => setShowOwnerPortal(true)} style={{ marginTop: 4, color: '#f59e0b' }}>
                  🏪 Are you a restaurant owner?
                </button>
                {status !== "Ready." && <p className="auth-status">{status}</p>}
              </div>
            ) : (
              <div className="profile-page">
                <div className="profile-header">
                  <div className="profile-avatar">👤</div>
                  <div>
                    <div className="profile-name">{email.split("@")[0]}</div>
                    <div className="profile-email">{email}</div>
                  </div>
                </div>
                <div className="profile-actions">
                  <button className="profile-action-btn" onClick={() => setShowOwnerPortal(true)}>
                    <span className="action-icon">🏪</span> Restaurant Owner Portal
                  </button>
                  <button className="profile-action-btn danger" onClick={handleLogout}>
                    <span className="action-icon">🚪</span> Log out
                  </button>
                </div>
              </div>
            )}
          </motion.div >
        )}
      </div >

      {/* Cart Panel */}
      < AnimatePresence >
        {showCartPanel && cartData && cartData.restaurants && cartData.restaurants.length > 0 && (
          <motion.div className="cart-panel" initial={{ y: 300 }} animate={{ y: 0 }} exit={{ y: 300 }} transition={{ type: "spring", damping: 25 }}>
            <div className="cart-panel-header">
              <span>🛒 Your Cart</span>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button className="cart-clear-btn" onClick={async () => {
                  try {
                    const c = await clearCart(token);
                    setCartData(c);
                    if (!c.restaurants || c.restaurants.length === 0) setShowCartPanel(false);
                  } catch { }
                }}>🗑 Clear All</button>
                <button className="cart-panel-close" onClick={() => setShowCartPanel(false)}>✕</button>
              </div>
            </div>
            <div className="cart-panel-body">
              {cartData.restaurants.map((group) => (
                <div key={group.restaurant_id} className="cart-restaurant-group">
                  <div className="cart-restaurant-name">🍽️ {group.restaurant_name}</div>
                  {group.items.map((item, i) => (
                    <div key={item.order_item_id || i} className="cart-item-row">
                      <span>{item.quantity}x {item.name}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>${(item.line_total_cents / 100).toFixed(2)}</span>
                        <button className="cart-item-delete" onClick={async () => {
                          try {
                            const c = await removeCartItem(token, item.order_item_id);
                            setCartData(c);
                            if (!c.restaurants || c.restaurants.length === 0) setShowCartPanel(false);
                          } catch { }
                        }}>✕</button>
                      </div>
                    </div>
                  ))}
                  <div className="cart-subtotal">Subtotal: ${(group.subtotal_cents / 100).toFixed(2)}</div>
                </div>
              ))}
            </div>
            <div className="cart-panel-footer">
              <div className="cart-grand-total">Grand Total: ${cartTotal}</div>
              <button className="cart-checkout-btn" disabled={checkingOut}
                onClick={async () => {
                  setCheckingOut(true);
                  try {
                    const res = await createCheckoutSession(token);
                    if (res.checkout_url && res.session_id !== 'sim_dev') {
                      // Redirect to Stripe Checkout
                      window.location.href = res.checkout_url;
                    } else {
                      // Dev mode: orders confirmed directly
                      setCartData(null); setShowCartPanel(false);
                      setTab("orders"); setOrdersTab("current");
                      setTimeout(() => { fetchMyOrders(token).then(setMyOrders).catch(() => { }); }, 500);
                      setTimeout(() => { fetchMyOrders(token).then(setMyOrders).catch(() => { }); }, 2000);
                      setTimeout(async () => {
                        try { const c = await fetchCart(token); setCartData(c); } catch { }
                        fetchMyOrders(token).then(setMyOrders).catch(() => { });
                      }, 5000);
                    }
                  } catch (err) { alert(err.message || "Checkout failed"); }
                  setCheckingOut(false);
                }}>
                {checkingOut ? "⏳ Processing Payment..." : "💳 Pay & Place Order"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence >

      {/* Budget Optimizer Modal */}
      < AnimatePresence >
        {showOptimizer && (
          <motion.div className="optimizer-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setShowOptimizer(false)}
          >
            <motion.div className="optimizer-modal"
              initial={{ opacity: 0, y: 60, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 40, scale: 0.95 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="optimizer-header">
                <span className="optimizer-title">💰 AI Budget Optimizer</span>
                <button className="optimizer-close" onClick={() => setShowOptimizer(false)}>✕</button>
              </div>

              <div className="optimizer-body">
                <p className="optimizer-desc">Find the best meal combo for your group — powered by AI.</p>

                <div className="optimizer-field">
                  <label>👥 People to feed</label>
                  <div className="optimizer-stepper">
                    <button onClick={() => setOptPeople(Math.max(1, optPeople - 1))}>−</button>
                    <span className="optimizer-stepper-value">{optPeople}</span>
                    <button onClick={() => setOptPeople(Math.min(50, optPeople + 1))}>+</button>
                  </div>
                </div>

                <div className="optimizer-field">
                  <label>💵 Budget ($)</label>
                  <input type="number" className="optimizer-input" min="1" max="1000"
                    value={optBudget} onChange={(e) => setOptBudget(Number(e.target.value) || 0)} />
                </div>

                <div className="optimizer-field">
                  <label>🍽️ Cuisine (optional)</label>
                  <select className="optimizer-input" value={optCuisine} onChange={(e) => setOptCuisine(e.target.value)}>
                    <option value="">Any cuisine</option>
                    <option value="Indian">Indian</option>
                    <option value="Italian">Italian</option>
                    <option value="Chinese">Chinese</option>
                    <option value="Mexican">Mexican</option>
                    <option value="Thai">Thai</option>
                    <option value="Japanese">Japanese</option>
                    <option value="American">American</option>
                  </select>
                </div>

                <motion.button className="optimizer-find-btn"
                  disabled={optLoading || optBudget < 1 || optPeople < 1}
                  whileTap={{ scale: 0.97 }}
                  onClick={async () => {
                    setOptLoading(true); setOptError(""); setOptResults(null);
                    try {
                      const res = await mealOptimizer({
                        people: optPeople,
                        budgetCents: optBudget * 100,
                        cuisine: optCuisine || undefined,
                      });
                      setOptResults(res);
                      if (!res.combos || res.combos.length === 0) {
                        setOptError("No combos found. Try a higher budget or fewer people.");
                      }
                    } catch (err) {
                      setOptError(err.message || "Optimizer failed");
                    }
                    setOptLoading(false);
                  }}
                >
                  {optLoading ? "⏳ Finding best combos..." : "🔍 Find Best Combo"}
                </motion.button>

                {optError && <div className="optimizer-error">{optError}</div>}

                {/* Results */}
                {optResults && optResults.combos && optResults.combos.length > 0 && (
                  <div className="optimizer-results">
                    {optResults.combos.map((combo, ci) => (
                      <motion.div key={ci} className="optimizer-combo-card"
                        initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: ci * 0.1 }}
                      >
                        <div className="combo-header">
                          <span className="combo-rank">{ci === 0 ? '🏆' : ci === 1 ? '🥈' : '🥉'}</span>
                          <span className="combo-restaurant">{combo.restaurant_name}</span>
                          <span className="combo-score">Score: {combo.score.toFixed(1)}</span>
                        </div>
                        <div className="combo-items">
                          {combo.items.map((item, ii) => (
                            <div key={ii} className="combo-item-row">
                              <span>{getFoodEmoji(item.name)} {item.quantity}x {item.name}</span>
                              <span className="combo-item-price">${(item.price_cents * item.quantity / 100).toFixed(2)}</span>
                            </div>
                          ))}
                        </div>
                        <div className="combo-footer">
                          <div className="combo-stats">
                            <span className="combo-total">Total: ${(combo.total_cents / 100).toFixed(2)}</span>
                            <span className="combo-feeds">Feeds {combo.feeds_people} people</span>
                          </div>
                          <button className="combo-order-btn" onClick={async () => {
                            setShowOptimizer(false);
                            // Add all items to cart in one shot via direct API
                            try {
                              const cartItems = combo.items.map(i => ({ item_id: i.item_id, quantity: i.quantity }));
                              const cart = await addComboToCart(token, combo.restaurant_id, cartItems);
                              setCartData(cart);
                              setShowCartPanel(true);
                            } catch (e) {
                              console.error('Failed to add items to cart:', e);
                            }
                          }}>
                            🛒 Order This
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence >

      {/* Bottom Nav */}
      < nav className="bottom-nav" >
        <button className={`nav-item ${tab === "home" ? "active" : ""}`} onClick={() => setTab("home")}>
          <span className="nav-icon">🏠</span>
          <span>Home</span>
        </button>
        <button className={`nav-item ${tab === "chat" ? "active" : ""}`} onClick={() => setTab("chat")}>
          <span className="nav-icon">💬</span>
          <span>Chat</span>
          {selectedRestaurant && <span className="nav-badge">●</span>}
        </button>
        <button className={`nav-item ${tab === "orders" ? "active" : ""}`} onClick={() => setTab("orders")}>
          <span className="nav-icon">📦</span>
          <span>Orders</span>
          {activeOrders.length > 0 && <span className="nav-badge">{activeOrders.length}</span>}
        </button>
        <button className={`nav-item ${tab === "profile" ? "active" : ""}`} onClick={() => setTab("profile")}>
          <span className="nav-icon">👤</span>
          <span>Profile</span>
        </button>
      </nav >
    </div >
  );
}
