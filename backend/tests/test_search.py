"""Tests for cross-restaurant price comparison search."""
import pytest
from .conftest import get_auth_header, create_test_restaurant, create_test_category, create_test_item


def _owner_token(client, email):
    resp = client.post("/auth/register-owner", json={"email": email, "password": "password123"})
    return resp.json()["access_token"]


class TestSearchMenuItems:
    def test_search_returns_results_sorted_by_price(self, client):
        """Create 3 restaurants with same item at different prices — should return cheapest first."""
        # Restaurant A: Biryani at $11.50
        t1 = _owner_token(client, "search_a@test.com")
        r1 = create_test_restaurant(client, t1, "Biryani House", "Austin")
        c1 = create_test_category(client, t1, r1.json()["id"], "Mains")
        create_test_item(client, t1, c1.json()["id"], "Chicken Biryani", 1150)

        # Restaurant B: Biryani at $15.20
        t2 = _owner_token(client, "search_b@test.com")
        r2 = create_test_restaurant(client, t2, "Royal Indian", "Dallas")
        c2 = create_test_category(client, t2, r2.json()["id"], "Rice")
        create_test_item(client, t2, c2.json()["id"], "Chicken Biryani", 1520)

        # Restaurant C: Biryani at $13.99
        t3 = _owner_token(client, "search_c@test.com")
        r3 = create_test_restaurant(client, t3, "Spice Garden", "Houston")
        c3 = create_test_category(client, t3, r3.json()["id"], "Specials")
        create_test_item(client, t3, c3.json()["id"], "Chicken Biryani", 1399)

        # Search
        resp = client.get("/search/menu-items?q=biryani")
        assert resp.status_code == 200
        data = resp.json()
        assert data["query"] == "biryani"
        assert len(data["results"]) >= 3

        # Best value should be cheapest
        assert data["best_value"] is not None
        assert data["best_value"]["price_cents"] == 1150
        assert data["best_value"]["restaurant_name"] == "Biryani House"

        # Results should be sorted by price (cheapest first among top-scored)
        prices = [r["price_cents"] for r in data["results"][:3]]
        assert prices == sorted(prices)

    def test_search_too_short_query(self, client):
        """Query under 2 chars should return 400."""
        resp = client.get("/search/menu-items?q=a")
        assert resp.status_code == 400

    def test_search_empty_query(self, client):
        """Empty query should return 400."""
        resp = client.get("/search/menu-items?q=")
        assert resp.status_code == 400

    def test_search_no_results(self, client):
        """Query with no matches should return empty results."""
        resp = client.get("/search/menu-items?q=xyznonexistent")
        assert resp.status_code == 200
        data = resp.json()
        assert data["results"] == []
        assert data["best_value"] is None

    def test_search_includes_restaurant_info(self, client):
        """Results should include restaurant name, id, and city."""
        t = _owner_token(client, "search_info@test.com")
        r = create_test_restaurant(client, t, "Info Test Place", "Chicago")
        c = create_test_category(client, t, r.json()["id"], "Bowls")
        create_test_item(client, t, c.json()["id"], "Poke Bowl", 1299)

        resp = client.get("/search/menu-items?q=poke")
        assert resp.status_code == 200
        data = resp.json()
        found = [x for x in data["results"] if x["restaurant_name"] == "Info Test Place"]
        assert len(found) >= 1
        assert found[0]["city"] == "Chicago"
        assert found[0]["restaurant_id"] == r.json()["id"]
