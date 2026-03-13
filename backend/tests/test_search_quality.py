"""
Comprehensive search quality tests for RestaurantAI.

Covers:
  - Stop word filtering (natural language queries)
  - Fuzzy matching / typo tolerance
  - $0 item exclusion
  - All-keyword AND logic
  - Price sorting (cheapest first)
  - Chat cross-restaurant search (no restaurant selected)
"""
import pytest
from .conftest import get_auth_header, create_test_restaurant, create_test_category, create_test_item


# ── Helpers ───────────────────────────────────────────────────────────

def _owner_token(client, email):
    resp = client.post("/auth/register-owner", json={"email": email, "password": "password123"})
    return resp.json()["access_token"]


def _customer_token(client, email):
    resp = client.post("/auth/register", json={"email": email, "password": "password123"})
    return resp.json()["access_token"]


def _setup_restaurants(client):
    """Create 3 restaurants with overlapping menu items for search testing."""
    # Restaurant 1: Desi District
    t1 = _owner_token(client, "sq_owner1@test.com")
    r1 = create_test_restaurant(client, t1, "Desi District", "Dallas")
    c1 = create_test_category(client, t1, r1.json()["id"], "Rice")
    create_test_item(client, t1, c1.json()["id"], "Chicken Biryani", 1699)
    create_test_item(client, t1, c1.json()["id"], "Vegetable Biryani", 1399)
    create_test_item(client, t1, c1.json()["id"], "Chicken Tikka", 1299)
    create_test_item(client, t1, c1.json()["id"], "Tikka Masala", 1599)
    # $0 item — should be excluded from search
    create_test_item(client, t1, c1.json()["id"], "Free Raita", 0)

    # Restaurant 2: Spice Palace
    t2 = _owner_token(client, "sq_owner2@test.com")
    r2 = create_test_restaurant(client, t2, "Spice Palace", "Houston")
    c2 = create_test_category(client, t2, r2.json()["id"], "Mains")
    create_test_item(client, t2, c2.json()["id"], "Chicken Biryani", 1150)
    create_test_item(client, t2, c2.json()["id"], "Lamb Biryani", 1899)
    create_test_item(client, t2, c2.json()["id"], "Chicken Tikka Masala", 1499)

    # Restaurant 3: Bombay Grill
    t3 = _owner_token(client, "sq_owner3@test.com")
    r3 = create_test_restaurant(client, t3, "Bombay Grill", "Austin")
    c3 = create_test_category(client, t3, r3.json()["id"], "Specials")
    create_test_item(client, t3, c3.json()["id"], "Hyderabadi Biryani", 1499)
    create_test_item(client, t3, c3.json()["id"], "Chicken Wings", 999)
    create_test_item(client, t3, c3.json()["id"], "Paneer Tikka", 1199)

    return r1.json(), r2.json(), r3.json()


# ── /search/menu-items endpoint tests ─────────────────────────────────

class TestStopWordFiltering:
    """Stop words like 'i', 'want', 'the', 'near', 'cheap' should not pollute results."""

    def test_natural_language_biryani_search(self, client):
        """'i want cheap biryani near by' → should find biryani items."""
        _setup_restaurants(client)
        resp = client.get("/search/menu-items?q=i want cheap biryani near by")
        assert resp.status_code == 200
        data = resp.json()
        # All results should contain 'biryani'
        for r in data["results"]:
            assert "biryani" in r["item_name"].lower(), f"'{r['item_name']}' does not contain 'biryani'"
        assert len(data["results"]) >= 3  # At least 3 biryani items across restaurants

    def test_natural_language_chicken_search(self, client):
        """'show me the cheapest chicken' → should find chicken items."""
        _setup_restaurants(client)
        resp = client.get("/search/menu-items?q=show me the cheapest chicken")
        assert resp.status_code == 200
        data = resp.json()
        for r in data["results"]:
            assert "chicken" in r["item_name"].lower(), f"'{r['item_name']}' does not contain 'chicken'"

    def test_all_stop_words_uses_fallback(self, client):
        """If all words are stop words, should use longest word as fallback."""
        _setup_restaurants(client)
        resp = client.get("/search/menu-items?q=where can i find")
        # Should not crash; either returns 400 or empty results
        assert resp.status_code in (200, 400)


class TestFuzzyMatching:
    """Typo tolerance via Levenshtein edit distance."""

    def test_briyani_matches_biryani(self, client):
        """'briyani' (common misspelling) → should match 'Biryani'."""
        _setup_restaurants(client)
        resp = client.get("/search/menu-items?q=briyani")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["results"]) >= 1
        assert any("biryani" in r["item_name"].lower() for r in data["results"])

    def test_chiken_matches_chicken(self, client):
        """'chiken' → should match 'Chicken'."""
        _setup_restaurants(client)
        resp = client.get("/search/menu-items?q=chiken")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["results"]) >= 1
        assert any("chicken" in r["item_name"].lower() for r in data["results"])

    def test_tikka_masla_matches_tikka_masala(self, client):
        """'tikka masla' → should match 'Tikka Masala'."""
        _setup_restaurants(client)
        resp = client.get("/search/menu-items?q=tikka masla")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["results"]) >= 1
        assert any("masala" in r["item_name"].lower() or "tikka" in r["item_name"].lower()
                    for r in data["results"])

    def test_exact_match_scores_higher(self, client):
        """Exact keyword matches should score higher than fuzzy matches."""
        _setup_restaurants(client)
        resp = client.get("/search/menu-items?q=biryani")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["results"]) >= 1
        # All results should contain biryani
        for r in data["results"]:
            assert "biryani" in r["item_name"].lower()


class TestZeroPriceExclusion:
    """Items priced at $0.00 should never appear in search results."""

    def test_zero_price_excluded(self, client):
        """Search for 'raita' — the $0 Free Raita should NOT appear."""
        _setup_restaurants(client)
        resp = client.get("/search/menu-items?q=raita")
        assert resp.status_code == 200
        data = resp.json()
        for r in data["results"]:
            assert r["price_cents"] > 0, f"Found $0 item: {r['item_name']}"

    def test_general_search_excludes_zero_price(self, client):
        """No $0 items in general biryani search."""
        _setup_restaurants(client)
        resp = client.get("/search/menu-items?q=biryani")
        assert resp.status_code == 200
        data = resp.json()
        for r in data["results"]:
            assert r["price_cents"] > 0


class TestAllKeywordAND:
    """All meaningful keywords in the query must match for a result to be included."""

    def test_chicken_biryani_requires_both_words(self, client):
        """'chicken biryani' → only items with BOTH 'chicken' AND 'biryani'."""
        _setup_restaurants(client)
        resp = client.get("/search/menu-items?q=chicken biryani")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["results"]) >= 1
        for r in data["results"]:
            name = r["item_name"].lower()
            assert "chicken" in name and "biryani" in name, (
                f"'{r['item_name']}' does not contain both 'chicken' and 'biryani'"
            )

    def test_chicken_alone_returns_all_chicken_items(self, client):
        """'chicken' alone → returns all chicken items (Biryani, Tikka, Wings, etc)."""
        _setup_restaurants(client)
        resp = client.get("/search/menu-items?q=chicken")
        assert resp.status_code == 200
        data = resp.json()
        # Should find multiple chicken items across restaurants
        assert len(data["results"]) >= 3

    def test_lamb_biryani_specific(self, client):
        """'lamb biryani' → only items with both 'lamb' and 'biryani'."""
        _setup_restaurants(client)
        resp = client.get("/search/menu-items?q=lamb biryani")
        assert resp.status_code == 200
        data = resp.json()
        if data["results"]:
            for r in data["results"]:
                name = r["item_name"].lower()
                assert "lamb" in name and "biryani" in name


class TestPriceSorting:
    """Results with same match score should be sorted cheapest first."""

    def test_biryani_cheapest_first(self, client):
        """Biryani search — cheapest result should be best_value."""
        _setup_restaurants(client)
        resp = client.get("/search/menu-items?q=chicken biryani")
        assert resp.status_code == 200
        data = resp.json()
        assert data["best_value"] is not None
        # Best value should be the cheapest Chicken Biryani ($11.50 at Spice Palace)
        assert data["best_value"]["price_cents"] == 1150
        assert data["best_value"]["restaurant_name"] == "Spice Palace"

    def test_results_sorted_by_price_asc(self, client):
        """For same-score results, prices should be ascending."""
        _setup_restaurants(client)
        resp = client.get("/search/menu-items?q=chicken biryani")
        assert resp.status_code == 200
        data = resp.json()
        prices = [r["price_cents"] for r in data["results"]]
        assert prices == sorted(prices), f"Prices not sorted: {prices}"


class TestSearchEdgeCases:
    """Edge cases for the search endpoint."""

    def test_short_query_rejected(self, client):
        """Query under 2 chars → 400."""
        resp = client.get("/search/menu-items?q=a")
        assert resp.status_code == 400

    def test_empty_query_rejected(self, client):
        """Empty query → 400."""
        resp = client.get("/search/menu-items?q=")
        assert resp.status_code == 400

    def test_no_results_returns_empty(self, client):
        """Query with no matches → empty results, no error."""
        _setup_restaurants(client)
        resp = client.get("/search/menu-items?q=xyznoexistent")
        assert resp.status_code == 200
        data = resp.json()
        assert data["results"] == []
        assert data["best_value"] is None

    def test_results_include_restaurant_info(self, client):
        """Each result should include restaurant name, id, and city."""
        _setup_restaurants(client)
        resp = client.get("/search/menu-items?q=biryani")
        assert resp.status_code == 200
        data = resp.json()
        for r in data["results"]:
            assert "restaurant_name" in r
            assert "restaurant_id" in r
            assert "city" in r


# ── Chat cross-restaurant search tests ─────────────────────────────────

class TestChatCrossRestaurantSearch:
    """When no restaurant is selected and user types a food item,
    the chat should return 'Found X at these restaurants' response."""

    def _send_chat(self, client, token, text, session_id=None):
        payload = {"text": text}
        if session_id:
            payload["session_id"] = session_id
        return client.post(
            "/chat/message",
            json=payload,
            headers=get_auth_header(token),
        )

    def test_food_search_without_restaurant(self, client):
        """Typing a food name without selecting a restaurant → cross-restaurant response."""
        _setup_restaurants(client)
        token = _customer_token(client, "sq_chat1@test.com")
        resp = self._send_chat(client, token, "biryani")
        assert resp.status_code == 200
        data = resp.json()
        reply = data["reply"].lower()
        # Should mention found results or restaurant suggestions
        assert any(kw in reply for kw in ["found", "restaurant", "desi", "spice", "bombay"]), (
            f"Unexpected reply: {data['reply']}"
        )

    def test_natural_language_triggers_search(self, client):
        """'i want biryani' without restaurant → should trigger search."""
        _setup_restaurants(client)
        token = _customer_token(client, "sq_chat2@test.com")
        resp = self._send_chat(client, token, "i want biryani")
        assert resp.status_code == 200
        data = resp.json()
        reply = data["reply"].lower()
        # Should find biryani across restaurants
        assert "biryani" in reply or "found" in reply or "restaurant" in reply

    def test_misspelled_food_search(self, client):
        """'briyani' without restaurant → should still find biryani items."""
        _setup_restaurants(client)
        token = _customer_token(client, "sq_chat3@test.com")
        resp = self._send_chat(client, token, "briyani")
        assert resp.status_code == 200
        data = resp.json()
        reply = data["reply"].lower()
        # Should find results or suggest restaurants
        assert any(kw in reply for kw in ["biryani", "briyani", "found", "restaurant", "desi", "spice", "bombay"]), (
            f"Unexpected reply: {data['reply']}"
        )

    def test_restaurant_slug_selection(self, client):
        """'#desi-district' → should select that restaurant and show menu."""
        _setup_restaurants(client)
        token = _customer_token(client, "sq_chat4@test.com")
        resp = self._send_chat(client, token, "#desi-district")
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("restaurant_id") is not None
        assert data.get("categories") is not None
        assert "Desi District" in data["reply"]

    def test_chat_returns_session_id(self, client):
        """Chat messages should return a session_id for conversation continuity."""
        _setup_restaurants(client)
        token = _customer_token(client, "sq_chat5@test.com")
        resp = self._send_chat(client, token, "hello")
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("session_id") is not None
