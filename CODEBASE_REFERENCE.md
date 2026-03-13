# RestaurantAI — Complete Codebase Reference

> Last updated: 2026-03-13  
> This document is the single source of truth for any agent or developer working on this codebase.

---

## 1. Project Overview

**RestaurantAI** is a full-stack AI-powered food ordering platform with:
- **AI Chat Ordering** — Natural language + voice-based ordering
- **Smart Search** — Intent extraction with typo tolerance and fuzzy matching
- **Budget Optimizer** — Greedy knapsack algorithm to find best meal combos
- **Meal Planner** — Multi-day meal plans with variety engine
- **Menu Extraction** — OCR/AI pipeline for PDFs, images, DOCX, XLSX
- **Owner Portal** — Restaurant management, analytics, orders
- **Payments** — Stripe integration for orders + subscriptions

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | FastAPI (Python), SQLAlchemy ORM |
| **Database** | SQLite (dev), PostgreSQL via Supabase (prod) |
| **Frontend** | React (Vite), vanilla CSS, Framer Motion |
| **AI/ML** | OpenAI API, Sarvam AI (Indian language LLM), Google Gemini Vision |
| **Payments** | Stripe (subscriptions + order checkout) |
| **Voice** | Browser SpeechRecognition (STT), Browser SpeechSynthesis (TTS) |
| **Desktop** | Tauri (in `frontend/src-tauri/`) |
| **Deployment** | Vercel (backend), Netlify (frontend) |
| **Testing** | pytest, 67-test AI regression dashboard |

---

## 3. Project Structure

```
restaurantai/
├── backend/
│   ├── app/
│   │   ├── main.py              # 2500 lines — ALL API endpoints
│   │   ├── models.py            # 11 SQLAlchemy models
│   │   ├── schemas.py           # Pydantic request/response schemas
│   │   ├── db.py                # Database engine + session (pool_size=20)
│   │   ├── config.py            # Settings via pydantic-settings + .env
│   │   ├── auth.py              # JWT authentication
│   │   ├── crud.py              # CRUD operations
│   │   ├── chat.py              # Chat engine (1164 lines) — voice + text ordering
│   │   ├── intent_extractor.py  # Hybrid intent extraction (571 lines)
│   │   ├── optimizer.py         # Budget optimizer (442 lines)
│   │   ├── menu_extractor.py    # OCR/document extraction (407 lines)
│   │   ├── payments.py          # Stripe integration (481 lines)
│   │   ├── voice.py             # Voice route handlers
│   │   ├── sarvam_service.py    # Sarvam AI API client
│   │   └── ai_dashboard.py      # 67-test regression dashboard
│   ├── tests/                   # 14 test files
│   │   ├── conftest.py          # Test fixtures + test DB setup
│   │   ├── intent_test_dataset.json  # 50 intent test cases
│   │   ├── test_intent_extractor.py  # Intent unit tests
│   │   ├── test_intent_dataset.py    # Data-driven intent tests
│   │   ├── test_search_quality.py    # Search quality tests
│   │   ├── test_search_pipeline.py   # End-to-end search tests
│   │   ├── test_meal_plan.py         # Meal plan endpoint tests
│   │   ├── test_menu_extraction.py   # Menu extraction tests
│   │   ├── test_auth.py, test_orders.py, test_owner.py, test_analytics.py
│   │   └── test_search.py
│   ├── .env                     # Environment variables (API keys)
│   └── vercel.json              # Vercel deployment config
├── frontend/
│   ├── src/
│   │   ├── App.jsx              # 1652 lines — Main customer app
│   │   ├── OwnerPortal.jsx      # 85KB — Restaurant owner dashboard
│   │   ├── SalesAnalytics.jsx   # Sales analytics component
│   │   ├── api.js               # API client (axios)
│   │   ├── main.jsx             # React entry point
│   │   └── styles.css           # 82KB — All styles
│   ├── public/                  # Static assets, food images
│   ├── src-tauri/               # Tauri desktop/iOS wrapper
│   └── package.json
├── netlify.toml                 # Netlify deployment config
└── supabase/                    # Supabase migrations
```

---

## 4. Database Models (`models.py`)

```
User ─────────────────── 1:N ──→ Restaurant (owner)
  │                                  │
  ├── 1:N → ChatSession              ├── 1:N → MenuCategory
  ├── 1:N → Order ←─────────────────┤            │
  └── 1:1 → Subscription             │            └── 1:N → MenuItem
                                      │
                                      └── 1:N → Order
                                                  │
                                                  └── 1:N → OrderItem

+ Payment (linked to User + Order)
+ ChatMessage (linked to ChatSession)
```

### Key Fields:
| Model | Key Fields |
|-------|-----------|
| **User** | email, password_hash, role (customer/owner/admin) |
| **Restaurant** | name, slug, city, lat/lng, rating, notification_email, owner_id |
| **MenuCategory** | name, sort_order, restaurant_id |
| **MenuItem** | name, price_cents, cuisine, protein_type, calories, portion_people |
| **Order** | user_id, restaurant_id, status (pending/confirmed/preparing/ready/completed/rejected), total_cents |
| **Subscription** | plan (free_trial/standard/corporate), status, stripe_customer_id, trial_start/end |

---

## 5. Backend Modules — Detailed

### 5.1 `main.py` — API Endpoints (2500 lines)

The main file contains ALL FastAPI route handlers. Key sections:

| Section | Endpoints | Purpose |
|---------|----------|---------|
| **Health** | `GET /health` | Uptime check |
| **Auth** | `POST /register`, `POST /login` | JWT auth |
| **Restaurants** | `GET /restaurants`, `GET /restaurants/nearby` | List + geo-based discovery (OpenStreetMap Overpass API) |
| **Search** | `GET /search/menu-items`, `POST /search/by-intent`, `GET /search/popular` | Cross-restaurant search with stop-word filtering, fuzzy matching, typo tolerance |
| **Budget Optimizer** | `POST /optimize-meal` | AI meal optimizer |
| **Meal Plan** | `POST /mealplan/generate`, `POST /mealplan/swap` | Multi-day meal planning with diversity engine |
| **Chat** | `POST /chat/session`, `POST /chat/message` | Conversational ordering |
| **Cart** | `GET /cart`, `DELETE /cart/item/{id}`, `DELETE /cart/clear`, `POST /cart/add-combo` | Multi-restaurant cart |
| **Owner Portal** | `POST /owner/register`, `GET /owner/restaurants`, `POST /owner/restaurants`, etc. | Full CRUD for restaurants, categories, items |
| **Orders** | `GET /owner/orders/{id}`, `PUT /owner/orders/{id}/status`, archived orders with pagination | Order management + real-time status |
| **Analytics** | `GET /owner/analytics/{id}` | Sales analytics |
| **Payments** | `POST /payments/checkout`, `POST /payments/webhook`, `POST /owner/subscribe` | Stripe checkout + webhooks |
| **Menu Upload** | `POST /owner/restaurants/{id}/upload-menu` | Image/document → structured menu |
| **Notifications** | Email notifications on order status change | SMTP email |
| **Web Scraping** | `POST /owner/restaurants/{id}/scrape-menu` | Playwright-based menu scraping |
| **Seed Data** | `POST /admin/seed` | Bulk restaurant + menu creation |
| **AI Dashboard** | `GET /admin/ai-dashboard`, `POST /admin/ai-diagnostics` | 67-test regression suite |

### 5.2 `intent_extractor.py` — Hybrid Intent Engine

**Two-layer architecture:**

1. **Layer 1 (Local, Fast, Free):** Regex-based extraction handles ~80% of queries
   - Extracts: dish_name, cuisine, diet_type, protein_type, spice_level, price_max, people_count, budget_total, meal_plan_mode, plan_days, recommendation_mode
   - Stop-word removal, typo-tolerant dish name extraction
   
2. **Layer 2 (LLM Fallback):** OpenAI or Sarvam AI for complex/ambiguous queries
   - Only called when local extraction lacks confidence
   - Results merged with local extraction

**Key data class: `FoodIntent`** — All extracted fields as Optional values

### 5.3 `chat.py` — Conversational Ordering Engine

Handles the full chat flow:
1. Restaurant selection (fuzzy name matching)
2. Category browsing
3. Item selection (fuzzy + LLM matching)
4. Quantity handling
5. Cart management
6. Voice prompt generation (TTS-friendly text)
7. Cross-restaurant search within chat

**Smart matching pipeline:**
- `_extract_restaurant_name()` — regex patterns for "order from X"
- `_find_best_restaurant()` — fuzzy match with edit distance
- `_find_best_item()` — multi-strategy scoring (substring, token match, edit distance)
- `_llm_match_item()` — Sarvam AI fallback for voice transcriptions
- `_search_items_across_restaurants()` — cross-restaurant search with stop-word filtering

### 5.4 `optimizer.py` — Budget Optimizer

**Algorithm: Greedy + Bounded Knapsack Search**

1. **Portion Estimation** — keyword heuristics + price-based estimation
2. **Scoring** — variety bonus, price efficiency, rating, "real food" bonus
3. **Combination Generation** — greedy fill with bounded enumeration
4. **LLM Explanation** — Sarvam AI generates human-friendly combo descriptions
5. **Main entry:** `optimize_meal(db, people, budget_cents, cuisine, restaurant_id)`

### 5.5 `menu_extractor.py` — Menu Ingestion Pipeline

Supports:
- **Images** (JPG, PNG, WebP) → Gemini Vision API → structured JSON
- **PDF** → pypdf/pdfplumber text extraction → Gemini AI parsing
- **DOCX** → python-docx text extraction → Gemini AI parsing
- **XLSX** → openpyxl text extraction → Gemini AI parsing

Output format: `{restaurant_name, categories: [{name, items: [{name, description, price_cents}]}]}`

### 5.6 `payments.py` — Stripe Integration

- **Owner Subscriptions:** Standard ($230/mo), Corporate ($400/mo), 30-day free trial
- **Customer Orders:** Cart checkout via Stripe Checkout Sessions
- **Dev Mode:** Simulated checkout without real Stripe
- **Webhooks:** `checkout.session.completed`, `customer.subscription.updated/deleted`
- **Trial Expiry:** Auto-marks expired trials, sends email notifications

### 5.7 `db.py` — Database Configuration

```python
pool_size=20, max_overflow=30, pool_timeout=60, pool_recycle=3600
```
Handles 50+ concurrent users. For 200+ users: switch to PostgreSQL + Gunicorn.

### 5.8 `config.py` — Settings

Loads from `.env`:
- `DATABASE_URL` — PostgreSQL connection string (Supabase in prod)
- `JWT_SECRET` — Authentication secret
- `CORS_ORIGINS` — localhost, Netlify, Tauri origins
- `OPENAI_API_KEY` — For LLM intent fallback

---

## 6. Frontend — Detailed

### 6.1 `App.jsx` (1652 lines) — Customer App

| Feature | Description |
|---------|-----------|
| **Home Tab** | Restaurant discovery with zipcode/city/GPS location, radius filter |
| **Chat Tab** | AI chat interface with text + voice input, search results, combo cards, meal plans |
| **Voice Mode** | Browser SpeechRecognition + SpeechSynthesis, hands-free ordering |
| **Menu Browser** | Category → items browsing with add-to-cart |
| **Cart** | Multi-restaurant cart with checkout |
| **Food Emoji Mapper** | Auto-assigns emojis based on item names |
| **Food Image Mapper** | Pattern-matched food images for visual cards |

### 6.2 `OwnerPortal.jsx` (85KB) — Owner Dashboard

| Feature | Description |
|---------|-----------|
| **Restaurant Management** | Create, edit, delete restaurants |
| **Menu Editor** | Full CRUD for categories and items |
| **Menu Upload** | Image/PDF/DOCX upload with AI extraction |
| **Order Management** | Real-time order status, active/archived tabs with search + date filters |
| **Analytics** | Sales charts (7-day, 30-day, 90-day) |
| **Settings** | Notifications, subscription management |
| **Pricing Page** | Trial status, upgrade to Standard/Corporate |

### 6.3 `api.js` — API Client

Axios-based client with:
- JWT token storage in localStorage
- Auth header injection
- Base URL from environment variable
- All endpoint methods exported

---

## 7. Search Architecture

```
User Query → intent_extractor.extract_intent_local()
                     │
                     ├─── dish_name, cuisine, price_max, diet_type, etc.
                     │
                     ▼
            Stop Word Removal → Fuzzy Matching → DB Query
                     │
                     ├─── Exact substring match (first pass)
                     ├─── Levenshtein distance ≤ 2 (typo tolerance)
                     ├─── ALL keywords must match (quality filter)
                     └─── Price filter: items with $0 excluded
                     │
                     ▼
              Sorted by price_cents ASC (cheapest first)
```

**Performance:** < 50ms average for search queries.

---

## 8. Testing Architecture

### Test Files (14 files in `backend/tests/`)

| File | Tests | Purpose |
|------|-------|---------|
| `test_intent_extractor.py` | 50+ | Unit tests for intent extraction |
| `test_intent_dataset.py` | 50 | Data-driven tests from JSON dataset |
| `test_search_quality.py` | 20+ | Stop words, typo tolerance, $0 filtering |
| `test_search_pipeline.py` | 10 | End-to-end search with API calls |
| `test_meal_plan.py` | 15 | Meal plan generate + swap endpoints |
| `test_menu_extraction.py` | 9 | Image, PDF, DOCX, XLSX extraction |
| `test_auth.py` | 5+ | Registration, login, JWT |
| `test_orders.py` | 8+ | Order CRUD, status transitions |
| `test_owner.py` | 8+ | Owner portal endpoints |
| `test_analytics.py` | 4+ | Sales analytics |
| `test_search.py` | 6+ | Basic search endpoint tests |

### AI Test Dashboard (`/admin/ai-dashboard`)

**67-test regression suite** run via browser — covers:
- 🎯 Intent Extraction (20 tests)
- 🔍 Search Accuracy (15 tests)
- 💰 Budget Optimizer (8 tests)
- 🍽️ Meal Planner (8 tests)
- 🧪 Edge Cases (15 tests — weird/vague/typo inputs)
- 🏥 System Health (1 test)

**Run before every deployment** to catch regressions.

---

## 9. Deployment

### Backend (Vercel)
- Config: `backend/vercel.json`
- Auto-deploys on `git push origin main`
- API URL: `https://restaurantai-***.vercel.app`

### Frontend (Netlify)
- Config: `netlify.toml`
- Auto-deploys on `git push origin main`
- URL: `https://zenzeerestaurantai.netlify.app`

### iOS App
- Built with Tauri (`frontend/src-tauri/`)
- Wrapper around the web frontend
- Points to production API — auto-updates with backend deploys

---

## 10. Environment Variables (`.env`)

```
DATABASE_URL=postgresql+psycopg2://...     # Supabase PostgreSQL
JWT_SECRET=...                              # Auth secret
OPENAI_API_KEY=...                          # OpenAI for intent fallback
GEMINI_API_KEY=...                          # Google Gemini for menu extraction
SARVAM_API_KEY=...                          # Sarvam AI for Indian language
STRIPE_SECRET_KEY=...                       # Stripe payments
STRIPE_WEBHOOK_SECRET=...                   # Stripe webhook verification
SMTP_EMAIL=...                              # Email notifications
SMTP_PASSWORD=...                           # Email app password
```

---

## 11. Key Design Decisions

1. **Hybrid Intent Extraction** — Regex first (free, <1ms), LLM fallback only when needed
2. **Stop Word Filtering** — Prevents "I want" from contaminating search results
3. **Fuzzy Matching (Levenshtein ≤ 2)** — Handles typos like "chiken" → "chicken"
4. **ALL Keywords Required** — Prevents irrelevant results
5. **Price in Cents** — Integer arithmetic, no floating-point precision issues
6. **Connection Pool Tuning** — pool_size=20, max_overflow=30 for concurrency
7. **Single main.py** — All routes in one file for simplicity (could be split later)
8. **No React Router** — Single-page app with tab-based navigation

---

## 12. Known Issues & Future Work

| Issue | Status | Notes |
|-------|--------|-------|
| Conversation context preservation (multi-turn) | ⚠️ Partial | Some context loss in complex multi-turn queries |
| test_owner.py pre-existing failure | ⚠️ Known | Unrelated to AI features |
| Scaling past 200 concurrent users | 📋 Planned | Need PostgreSQL + Gunicorn + Redis caching |
| main.py is 2500 lines | 📋 Planned | Should be split into routers |
| Intent extractor doesn't auto-correct typos in dish_name | 📋 Known | "chiken" stays as "chiken" — search handles it via fuzzy match |

---

## 13. Common Commands

```bash
# Backend
cd backend && uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend && npm run dev

# Run tests
cd backend && python -m pytest tests/ -v

# AI Dashboard
open http://localhost:8000/admin/ai-dashboard

# Deploy
git add -A && git commit -m "..." && git push origin main
```
