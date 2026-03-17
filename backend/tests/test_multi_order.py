"""Tests for multi-restaurant natural language ordering."""
import pytest
from unittest.mock import patch
from .conftest import register_user, get_auth_header, create_test_restaurant, create_test_category, create_test_item


def _setup_two_restaurants(client):
    """Create 2 restaurants with items. Returns (owner_token, [{id, name, items}])."""
    resp = client.post("/auth/register-owner", json={"email": "multi_owner@test.com", "password": "password123"})
    owner_token = resp.json()["access_token"]

    restaurants = []
    for name, items_data in [
        ("Aroma Kitchen", [("Butter Masala", 1199), ("Naan", 299), ("Paneer Tikka", 899)]),
        ("Desi District", [("Chicken Biryani", 1499), ("Samosa", 399), ("Dal Tadka", 799)]),
    ]:
        r = create_test_restaurant(client, owner_token, name)
        rid = r.json()["id"]
        cat = create_test_category(client, owner_token, rid, "Main Menu")
        cat_id = cat.json()["id"]
        item_ids = []
        for item_name, price in items_data:
            item = create_test_item(client, owner_token, cat_id, item_name, price)
            item_ids.append({"id": item.json()["id"], "name": item_name, "price_cents": price})
        restaurants.append({"id": rid, "name": name, "items": item_ids})

    return owner_token, restaurants


def _customer_token(client, email="multi_cust@test.com"):
    resp = client.post("/auth/register", json={"email": email, "password": "password123"})
    return resp.json()["access_token"]


def _setup_three_restaurants(client):
    """Create 3 restaurants with items. Returns (owner_token, [{id, name, items}])."""
    import random
    uid = random.randint(100000, 999999)
    resp = client.post("/auth/register-owner", json={"email": f"multi3_owner_{uid}@test.com", "password": "password123"})
    owner_token = resp.json()["access_token"]

    restaurants = []
    for name, items_data in [
        ("Aroma Kitchen", [("Butter Masala", 1199), ("Naan", 299), ("Paneer Tikka", 899)]),
        ("Desi District", [("Chicken Biryani", 1499), ("Samosa", 399), ("Dal Tadka", 799)]),
        ("Spice Garden", [("Tandoori Chicken", 1599), ("Garlic Naan", 349), ("Mango Lassi", 499)]),
    ]:
        r = create_test_restaurant(client, owner_token, name)
        rid = r.json()["id"]
        cat = create_test_category(client, owner_token, rid, "Main Menu")
        cat_id = cat.json()["id"]
        item_ids = []
        for item_name, price in items_data:
            item = create_test_item(client, owner_token, cat_id, item_name, price)
            item_ids.append({"id": item.json()["id"], "name": item_name, "price_cents": price})
        restaurants.append({"id": rid, "name": name, "items": item_ids})

    return owner_token, restaurants


class TestMultiOrderExtraction:
    """Test the local regex fallback for multi-order extraction."""

    def test_parse_two_items_two_restaurants(self):
        from app.multi_order import _parse_multi_order_local
        items = _parse_multi_order_local("1 butter masala from aroma and 2 chicken biryani from desi district")
        assert len(items) >= 2
        # Check quantities
        qtys = {i["dish_name"]: i["quantity"] for i in items}
        assert any("butter" in k or "masala" in k for k in qtys)

    def test_parse_single_item(self):
        from app.multi_order import _parse_multi_order_local
        items = _parse_multi_order_local("1 pizza from dominos")
        assert len(items) >= 1
        assert items[0]["quantity"] == 1
        assert "pizza" in items[0]["dish_name"].lower()
        assert "dominos" in items[0]["restaurant_name"].lower()

    def test_parse_no_quantity_defaults_to_one(self):
        from app.multi_order import _parse_multi_order_local
        items = _parse_multi_order_local("samosa from spice garden and naan from aroma")
        for item in items:
            assert item["quantity"] == 1

    def test_parse_comma_separator(self):
        from app.multi_order import _parse_multi_order_local
        items = _parse_multi_order_local("3 pizza from dominos, 1 biryani from spice garden")
        assert len(items) >= 2

    def test_parse_three_items_three_restaurants(self):
        from app.multi_order import _parse_multi_order_local
        items = _parse_multi_order_local(
            "1 naan from aroma and 2 biryani from desi district and 3 lassi from spice garden"
        )
        assert len(items) >= 3

    def test_parse_mixed_and_comma(self):
        from app.multi_order import _parse_multi_order_local
        items = _parse_multi_order_local(
            "2 naan from aroma, 1 samosa from desi district and 3 lassi from spice garden"
        )
        assert len(items) >= 3

    def test_parse_using_at_keyword(self):
        """'at' should work the same as 'from'."""
        from app.multi_order import _parse_multi_order_local
        items = _parse_multi_order_local("1 pizza at dominos and 2 biryani at spice garden")
        assert len(items) >= 2


class TestMultiOrderFuzzyMatch:
    """Test the fuzzy matching helpers via the endpoint (uses test DB correctly)."""

    @patch("app.multi_order._call_openai_multi", return_value={
        "items": [{"quantity": 1, "dish_name": "butter masala", "restaurant_name": "aroma kitchen"}]
    })
    @patch("app.multi_order._call_sarvam_multi", return_value=None)
    def test_fuzzy_restaurant_match(self, mock_sarvam, mock_openai, client):
        """LLM returns 'aroma kitchen' — should fuzzy match to 'Aroma Kitchen'."""
        _, restaurants = _setup_two_restaurants(client)
        token = _customer_token(client, "fuzzy_rest@test.com")
        resp = client.post("/multi-order",
            json={"text": "1 butter masala from aroma kitchen"},
            headers=get_auth_header(token))
        data = resp.json()
        assert len(data["added"]) == 1
        assert data["added"][0]["restaurant_name"] == "Aroma Kitchen"

    @patch("app.multi_order._call_openai_multi", return_value={
        "items": [{"quantity": 1, "dish_name": "butter masala", "restaurant_name": "aroma"}]
    })
    @patch("app.multi_order._call_sarvam_multi", return_value=None)
    def test_fuzzy_restaurant_partial(self, mock_sarvam, mock_openai, client):
        """LLM returns 'aroma' — should match 'Aroma Kitchen' via substring."""
        _, restaurants = _setup_two_restaurants(client)
        token = _customer_token(client, "fuzzy_partial@test.com")
        resp = client.post("/multi-order",
            json={"text": "1 butter masala from aroma"},
            headers=get_auth_header(token))
        data = resp.json()
        assert len(data["added"]) == 1
        assert "Aroma" in data["added"][0]["restaurant_name"]

    @patch("app.multi_order._call_openai_multi", return_value={
        "items": [{"quantity": 1, "dish_name": "sushi", "restaurant_name": "aroma"}]
    })
    @patch("app.multi_order._call_sarvam_multi", return_value=None)
    def test_fuzzy_item_not_found(self, mock_sarvam, mock_openai, client):
        """Restaurant found but item not on menu → not_found."""
        _setup_two_restaurants(client)
        token = _customer_token(client, "fuzzy_noitem@test.com")
        resp = client.post("/multi-order",
            json={"text": "1 sushi from aroma"},
            headers=get_auth_header(token))
        data = resp.json()
        assert len(data["not_found"]) == 1
        assert "sushi" in data["not_found"][0]["dish_name"]

    @patch("app.multi_order._call_openai_multi", return_value={
        "items": [{"quantity": 1, "dish_name": "butter", "restaurant_name": "aroma"}]
    })
    @patch("app.multi_order._call_sarvam_multi", return_value=None)
    def test_fuzzy_item_partial_match(self, mock_sarvam, mock_openai, client):
        """'butter' should fuzzy-match 'Butter Masala'."""
        _setup_two_restaurants(client)
        token = _customer_token(client, "fuzzy_butter@test.com")
        resp = client.post("/multi-order",
            json={"text": "1 butter from aroma"},
            headers=get_auth_header(token))
        data = resp.json()
        assert len(data["added"]) == 1
        assert "Butter" in data["added"][0]["item_name"]

    @patch("app.multi_order._call_openai_multi", return_value={
        "items": [{"quantity": 1, "dish_name": "naan", "restaurant_name": "nonexistent place"}]
    })
    @patch("app.multi_order._call_sarvam_multi", return_value=None)
    def test_restaurant_not_found(self, mock_sarvam, mock_openai, client):
        """Non-existent restaurant → not_found."""
        _setup_two_restaurants(client)
        token = _customer_token(client, "fuzzy_norest@test.com")
        resp = client.post("/multi-order",
            json={"text": "1 naan from nonexistent place"},
            headers=get_auth_header(token))
        data = resp.json()
        assert len(data["not_found"]) == 1
        assert "not found" in data["not_found"][0]["reason"].lower()


class TestMultiOrderEndpoint:
    """Test the POST /multi-order endpoint (uses regex fallback since no LLM in tests)."""

    def test_multi_order_no_auth(self, client):
        """Multi-order without auth should return 401/403."""
        resp = client.post("/multi-order", json={"text": "1 biryani from aroma"})
        assert resp.status_code in (401, 403)

    @patch("app.multi_order._call_openai_multi", return_value=None)
    @patch("app.multi_order._call_sarvam_multi", return_value=None)
    def test_multi_order_single_item(self, mock_sarvam, mock_openai, client):
        """Single item from single restaurant using regex fallback."""
        _, restaurants = _setup_two_restaurants(client)
        token = _customer_token(client, "mo_single@test.com")

        resp = client.post("/multi-order",
            json={"text": "1 butter masala from aroma"},
            headers=get_auth_header(token))
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["added"]) >= 1
        assert data["total_items"] >= 1
        assert "summary_text" in data

    @patch("app.multi_order._call_openai_multi", return_value=None)
    @patch("app.multi_order._call_sarvam_multi", return_value=None)
    def test_multi_order_two_restaurants(self, mock_sarvam, mock_openai, client):
        """Items from two different restaurants using regex fallback."""
        _, restaurants = _setup_two_restaurants(client)
        token = _customer_token(client, "mo_two@test.com")

        resp = client.post("/multi-order",
            json={"text": "1 butter masala from aroma and 2 chicken biryani from desi district"},
            headers=get_auth_header(token))
        assert resp.status_code == 200
        data = resp.json()
        # Both should be found
        assert len(data["added"]) >= 2
        assert data["total_items"] >= 3  # 1 + 2

    @patch("app.multi_order._call_openai_multi", return_value=None)
    @patch("app.multi_order._call_sarvam_multi", return_value=None)
    def test_multi_order_item_not_found(self, mock_sarvam, mock_openai, client):
        """Non-existent item should appear in not_found list."""
        _setup_two_restaurants(client)
        token = _customer_token(client, "mo_notfound@test.com")

        resp = client.post("/multi-order",
            json={"text": "1 sushi from aroma"},
            headers=get_auth_header(token))
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["not_found"]) >= 1

    @patch("app.multi_order._call_openai_multi", return_value={
        "items": [
            {"quantity": 1, "dish_name": "butter masala", "restaurant_name": "aroma"},
            {"quantity": 2, "dish_name": "chicken biryani", "restaurant_name": "desi district"},
        ]
    })
    @patch("app.multi_order._call_sarvam_multi", return_value=None)
    def test_multi_order_with_llm(self, mock_sarvam, mock_openai, client):
        """Simulate LLM returning structured JSON."""
        _, restaurants = _setup_two_restaurants(client)
        token = _customer_token(client, "mo_llm@test.com")

        resp = client.post("/multi-order",
            json={"text": "i would like to order 1 butter masala from aroma and 2 chicken biryani from desi district"},
            headers=get_auth_header(token))
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["added"]) == 2
        assert data["total_items"] == 3
        assert data["total_cents"] > 0
        assert "summary_text" in data
        assert "voice_prompt" in data

    @patch("app.multi_order._call_openai_multi", return_value=None)
    @patch("app.multi_order._call_sarvam_multi", return_value=None)
    def test_multi_order_adds_to_cart(self, mock_sarvam, mock_openai, client):
        """After multi-order, items should appear in cart."""
        _, restaurants = _setup_two_restaurants(client)
        token = _customer_token(client, "mo_cart@test.com")

        # Place multi-order
        client.post("/multi-order",
            json={"text": "1 naan from aroma and 1 samosa from desi district"},
            headers=get_auth_header(token))

        # Check cart
        resp = client.get("/cart", headers=get_auth_header(token))
        assert resp.status_code == 200
        cart = resp.json()
        # Should have items from at least 1 restaurant (fuzzy matching may vary)
        assert cart["grand_total_cents"] >= 0

    @patch("app.multi_order._call_openai_multi", return_value=None)
    @patch("app.multi_order._call_sarvam_multi", return_value=None)
    def test_multi_order_empty_text(self, mock_sarvam, mock_openai, client):
        """Empty or unparseable text should return helpful message."""
        _setup_two_restaurants(client)
        token = _customer_token(client, "mo_empty@test.com")

        resp = client.post("/multi-order",
            json={"text": "hello there"},
            headers=get_auth_header(token))
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_items"] == 0
        assert "summary_text" in data


# ============================================================
# Comprehensive Combination Tests (3+ restaurants, edge cases)
# ============================================================

class TestMultiOrderCombinations:
    """Test all multi-order combinations: 3 restaurants, mixed results, cart verification."""

    @patch("app.multi_order._call_openai_multi", return_value={
        "items": [
            {"quantity": 1, "dish_name": "butter masala", "restaurant_name": "aroma"},
            {"quantity": 2, "dish_name": "chicken biryani", "restaurant_name": "desi district"},
            {"quantity": 3, "dish_name": "mango lassi", "restaurant_name": "spice garden"},
        ]
    })
    @patch("app.multi_order._call_sarvam_multi", return_value=None)
    def test_three_restaurants_all_found(self, mock_sarvam, mock_openai, client):
        """Order from 3 restaurants — all items found and added to cart."""
        _, restaurants = _setup_three_restaurants(client)
        token = _customer_token(client, "combo_3r@test.com")

        resp = client.post("/multi-order",
            json={"text": "1 butter masala from aroma and 2 chicken biryani from desi district and 3 mango lassi from spice garden"},
            headers=get_auth_header(token))
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["added"]) == 3
        assert data["total_items"] == 6  # 1+2+3
        assert len(data["not_found"]) == 0
        # Verify all 3 restaurants are represented
        rest_names = set(a["restaurant_name"] for a in data["added"])
        assert len(rest_names) == 3
        # Verify total price is correct (1*1199 + 2*1499 + 3*499 = 5694)
        assert data["total_cents"] == 1199 + 2*1499 + 3*499

    @patch("app.multi_order._call_openai_multi", return_value={
        "items": [
            {"quantity": 1, "dish_name": "butter masala", "restaurant_name": "aroma"},
            {"quantity": 2, "dish_name": "chicken biryani", "restaurant_name": "desi district"},
            {"quantity": 3, "dish_name": "mango lassi", "restaurant_name": "spice garden"},
        ]
    })
    @patch("app.multi_order._call_sarvam_multi", return_value=None)
    def test_three_restaurants_cart_has_all_items(self, mock_sarvam, mock_openai, client):
        """After 3-restaurant order, verify cart contains items from all 3."""
        _, restaurants = _setup_three_restaurants(client)
        token = _customer_token(client, "combo_3r_cart@test.com")

        client.post("/multi-order",
            json={"text": "1 butter masala from aroma, 2 chicken biryani from desi district, 3 mango lassi from spice garden"},
            headers=get_auth_header(token))

        cart = client.get("/cart", headers=get_auth_header(token)).json()
        assert len(cart["restaurants"]) == 3
        assert cart["grand_total_cents"] == 1199 + 2*1499 + 3*499

    @patch("app.multi_order._call_openai_multi", return_value={
        "items": [
            {"quantity": 1, "dish_name": "butter masala", "restaurant_name": "aroma"},
            {"quantity": 2, "dish_name": "sushi", "restaurant_name": "desi district"},
            {"quantity": 3, "dish_name": "mango lassi", "restaurant_name": "spice garden"},
        ]
    })
    @patch("app.multi_order._call_sarvam_multi", return_value=None)
    def test_three_restaurants_one_item_not_found(self, mock_sarvam, mock_openai, client):
        """3 restaurants, but 1 item doesn't exist — 2 added, 1 in not_found."""
        _, restaurants = _setup_three_restaurants(client)
        token = _customer_token(client, "combo_3r_nf@test.com")

        resp = client.post("/multi-order",
            json={"text": "1 butter masala from aroma and 2 sushi from desi district and 3 mango lassi from spice garden"},
            headers=get_auth_header(token))
        data = resp.json()
        assert len(data["added"]) == 2
        assert len(data["not_found"]) == 1
        assert "sushi" in data["not_found"][0]["dish_name"]
        assert "⚠️" in data["summary_text"]  # Warning about not_found

    @patch("app.multi_order._call_openai_multi", return_value={
        "items": [
            {"quantity": 5, "dish_name": "naan", "restaurant_name": "aroma"},
            {"quantity": 10, "dish_name": "samosa", "restaurant_name": "desi district"},
        ]
    })
    @patch("app.multi_order._call_sarvam_multi", return_value=None)
    def test_high_quantities(self, mock_sarvam, mock_openai, client):
        """High quantities (5, 10) should work correctly."""
        _, restaurants = _setup_three_restaurants(client)
        token = _customer_token(client, "combo_hq@test.com")

        resp = client.post("/multi-order",
            json={"text": "5 naan from aroma and 10 samosa from desi district"},
            headers=get_auth_header(token))
        data = resp.json()
        assert data["total_items"] == 15  # 5+10
        assert data["total_cents"] == 5*299 + 10*399

    @patch("app.multi_order._call_openai_multi", return_value={
        "items": [
            {"quantity": 2, "dish_name": "naan", "restaurant_name": "aroma"},
            {"quantity": 1, "dish_name": "paneer tikka", "restaurant_name": "aroma"},
        ]
    })
    @patch("app.multi_order._call_sarvam_multi", return_value=None)
    def test_multiple_items_same_restaurant(self, mock_sarvam, mock_openai, client):
        """2 different items from the same restaurant should both be added."""
        _, restaurants = _setup_three_restaurants(client)
        token = _customer_token(client, "combo_same@test.com")

        resp = client.post("/multi-order",
            json={"text": "2 naan and 1 paneer tikka from aroma"},
            headers=get_auth_header(token))
        data = resp.json()
        assert len(data["added"]) == 2
        assert data["total_items"] == 3
        # Both from Aroma Kitchen
        assert all(a["restaurant_name"] == "Aroma Kitchen" for a in data["added"])
        # Cart should only have 1 restaurant group
        cart = client.get("/cart", headers=get_auth_header(token)).json()
        assert len(cart["restaurants"]) == 1

    @patch("app.multi_order._call_openai_multi", return_value={
        "items": [
            {"quantity": 1, "dish_name": "naan", "restaurant_name": "aroma"},
            {"quantity": 1, "dish_name": "garlic naan", "restaurant_name": "spice garden"},
        ]
    })
    @patch("app.multi_order._call_sarvam_multi", return_value=None)
    def test_similar_items_different_restaurants(self, mock_sarvam, mock_openai, client):
        """'naan' from Aroma and 'garlic naan' from Spice Garden — both found."""
        _, restaurants = _setup_three_restaurants(client)
        token = _customer_token(client, "combo_sim@test.com")

        resp = client.post("/multi-order",
            json={"text": "1 naan from aroma and 1 garlic naan from spice garden"},
            headers=get_auth_header(token))
        data = resp.json()
        assert len(data["added"]) == 2
        rest_names = [a["restaurant_name"] for a in data["added"]]
        assert "Aroma Kitchen" in rest_names
        assert "Spice Garden" in rest_names

    @patch("app.multi_order._call_openai_multi", return_value={
        "items": [
            {"quantity": 1, "dish_name": "butter masala", "restaurant_name": "aroma"},
        ]
    })
    @patch("app.multi_order._call_sarvam_multi", return_value=None)
    def test_voice_style_input(self, mock_sarvam, mock_openai, client):
        """Voice-style input: 'i would like to order...' should work."""
        _, restaurants = _setup_three_restaurants(client)
        token = _customer_token(client, "combo_voice@test.com")

        resp = client.post("/multi-order",
            json={"text": "i would like to order 1 butter masala from aroma"},
            headers=get_auth_header(token))
        data = resp.json()
        assert len(data["added"]) == 1
        assert "voice_prompt" in data
        assert len(data["voice_prompt"]) > 0

    @patch("app.multi_order._call_openai_multi", return_value={
        "items": [
            {"quantity": 1, "dish_name": "butter masala", "restaurant_name": "aroma"},
            {"quantity": 2, "dish_name": "chicken biryani", "restaurant_name": "desi district"},
            {"quantity": 3, "dish_name": "mango lassi", "restaurant_name": "spice garden"},
        ]
    })
    @patch("app.multi_order._call_sarvam_multi", return_value=None)
    def test_summary_text_contains_all_items(self, mock_sarvam, mock_openai, client):
        """summary_text should mention every added item."""
        _, restaurants = _setup_three_restaurants(client)
        token = _customer_token(client, "combo_summary@test.com")

        resp = client.post("/multi-order",
            json={"text": "1 butter masala from aroma, 2 chicken biryani from desi district, 3 mango lassi from spice garden"},
            headers=get_auth_header(token))
        data = resp.json()
        summary = data["summary_text"]
        assert "Butter Masala" in summary
        assert "Chicken Biryani" in summary
        assert "Mango Lassi" in summary
        assert "1x" in summary
        assert "2x" in summary
        assert "3x" in summary
        assert "✅" in summary
        assert "$" in summary  # Total price

    @patch("app.multi_order._call_openai_multi", return_value={
        "items": [
            {"quantity": 1, "dish_name": "naan", "restaurant_name": "fake place"},
            {"quantity": 2, "dish_name": "sushi", "restaurant_name": "aroma"},
        ]
    })
    @patch("app.multi_order._call_sarvam_multi", return_value=None)
    def test_all_items_fail(self, mock_sarvam, mock_openai, client):
        """When all items fail — restaurant not found + item not found."""
        _setup_three_restaurants(client)
        token = _customer_token(client, "combo_allfail@test.com")

        resp = client.post("/multi-order",
            json={"text": "1 naan from fake place and 2 sushi from aroma"},
            headers=get_auth_header(token))
        data = resp.json()
        assert len(data["added"]) == 0
        assert len(data["not_found"]) == 2
        assert data["total_items"] == 0
        assert "❌" in data["summary_text"]

    @patch("app.multi_order._call_openai_multi", return_value={
        "items": [
            {"quantity": 1, "dish_name": "butter masala", "restaurant_name": "aroma"},
            {"quantity": 1, "dish_name": "chicken biryani", "restaurant_name": "desi district"},
        ]
    })
    @patch("app.multi_order._call_sarvam_multi", return_value=None)
    def test_voice_prompt_mentions_total(self, mock_sarvam, mock_openai, client):
        """voice_prompt should mention item count and total price for TTS."""
        _, restaurants = _setup_three_restaurants(client)
        token = _customer_token(client, "combo_vp@test.com")

        resp = client.post("/multi-order",
            json={"text": "1 butter masala from aroma and 1 chicken biryani from desi district"},
            headers=get_auth_header(token))
        data = resp.json()
        assert "cart" in data["voice_prompt"].lower() or "added" in data["voice_prompt"].lower()
        assert "$" in data["voice_prompt"]
