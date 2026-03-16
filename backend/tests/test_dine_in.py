"""Tests for Phase 2: QR Code Dine-In Ordering."""
import pytest
from .conftest import register_user, get_auth_header, create_test_restaurant, create_test_category, create_test_item


def _setup_dine_in_restaurant(client):
    """Create owner + restaurant with dine_in_enabled=True, a category, and items."""
    resp = client.post("/auth/register-owner", json={"email": f"dinein_owner_{id(client)}@test.com", "password": "password123"})
    owner_token = resp.json()["access_token"]

    r = client.post("/owner/restaurants", json={
        "name": "Dine-In Test Bistro",
        "city": "Test City",
        "dine_in_enabled": True,
    }, headers=get_auth_header(owner_token))
    rid = r.json()["id"]
    slug = r.json()["slug"]

    cat = create_test_category(client, owner_token, rid, "Starters")
    cat_id = cat.json()["id"]
    item1 = create_test_item(client, owner_token, cat_id, "Garlic Bread", 599)
    item2 = create_test_item(client, owner_token, cat_id, "Soup of the Day", 799)

    return owner_token, rid, slug, [item1.json()["id"], item2.json()["id"]]


def _customer_token(client, email="dinein_cust@test.com"):
    resp = client.post("/auth/register", json={"email": email, "password": "password123"})
    return resp.json()["access_token"]


class TestDineIn:
    """Tests for QR code dine-in ordering feature."""

    def test_dine_in_endpoint_returns_restaurant(self, client):
        """GET /dine-in/{slug} returns restaurant data with categories and menu."""
        owner_token, rid, slug, item_ids = _setup_dine_in_restaurant(client)
        resp = client.get(f"/dine-in/{slug}?table=5")
        assert resp.status_code == 200
        data = resp.json()
        assert data["restaurant_id"] == rid
        assert data["restaurant_name"] == "Dine-In Test Bistro"
        assert data["slug"] == slug
        assert data["dine_in_enabled"] is True
        assert data["table_number"] == "5"
        assert len(data["categories"]) >= 1
        assert len(data["categories"][0]["items"]) >= 1

    def test_dine_in_disabled_returns_404(self, client):
        """GET /dine-in/{slug} returns 404 when dine_in_enabled=False."""
        resp = client.post("/auth/register-owner", json={"email": "dinein_dis@test.com", "password": "password123"})
        owner_token = resp.json()["access_token"]
        r = client.post("/owner/restaurants", json={
            "name": "No Dine-In Place",
            "city": "Test City",
            "dine_in_enabled": False,
        }, headers=get_auth_header(owner_token))
        slug = r.json()["slug"]
        resp = client.get(f"/dine-in/{slug}")
        assert resp.status_code == 404

    def test_dine_in_order_creates_order(self, client):
        """POST /dine-in/order creates order with order_type=dine_in and table_number."""
        owner_token, rid, slug, item_ids = _setup_dine_in_restaurant(client)
        token = _customer_token(client, "dinein_order@test.com")
        resp = client.post("/dine-in/order", json={
            "restaurant_id": rid,
            "table_number": "7",
            "items": [
                {"item_id": item_ids[0], "quantity": 2},
                {"item_id": item_ids[1], "quantity": 1},
            ],
        }, headers=get_auth_header(token))
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["order_type"] == "dine_in"
        assert data["table_number"] == "7"
        assert data["total_cents"] == 599 * 2 + 799
        assert len(data["items"]) == 2

    def test_dine_in_order_no_auth(self, client):
        """POST /dine-in/order without auth returns 401/403."""
        resp = client.post("/dine-in/order", json={
            "restaurant_id": 1,
            "table_number": "1",
            "items": [{"item_id": 1, "quantity": 1}],
        })
        assert resp.status_code in (401, 403)

    def test_dine_in_order_appears_in_owner_orders(self, client):
        """Owner sees dine-in orders with order_type and table_number."""
        owner_token, rid, slug, item_ids = _setup_dine_in_restaurant(client)
        token = _customer_token(client, "dinein_owner_view@test.com")
        client.post("/dine-in/order", json={
            "restaurant_id": rid,
            "table_number": "3",
            "items": [{"item_id": item_ids[0], "quantity": 1}],
        }, headers=get_auth_header(token))

        resp = client.get(
            f"/owner/restaurants/{rid}/orders?exclude_status=",
            headers=get_auth_header(owner_token),
        )
        assert resp.status_code == 200
        orders = resp.json()
        dine_in_orders = [o for o in orders if o.get("order_type") == "dine_in"]
        assert len(dine_in_orders) >= 1
        assert dine_in_orders[0]["table_number"] == "3"

    def test_dine_in_order_appears_in_my_orders(self, client):
        """Customer sees dine-in order in /my-orders with table info."""
        owner_token, rid, slug, item_ids = _setup_dine_in_restaurant(client)
        token = _customer_token(client, "dinein_my_orders@test.com")
        client.post("/dine-in/order", json={
            "restaurant_id": rid,
            "table_number": "12",
            "items": [{"item_id": item_ids[0], "quantity": 1}],
        }, headers=get_auth_header(token))

        resp = client.get("/my-orders", headers=get_auth_header(token))
        assert resp.status_code == 200
        orders = resp.json()
        assert len(orders) >= 1
        assert orders[0]["order_type"] == "dine_in"
        assert orders[0]["table_number"] == "12"

    def test_qr_codes_endpoint(self, client):
        """GET /owner/restaurants/{id}/qr-codes returns correct table URLs."""
        owner_token, rid, slug, item_ids = _setup_dine_in_restaurant(client)
        resp = client.get(
            f"/owner/restaurants/{rid}/qr-codes?table_count=3",
            headers=get_auth_header(owner_token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["restaurant_id"] == rid
        assert len(data["tables"]) == 3
        assert data["tables"][0]["table_number"] == "1"
        assert slug in data["tables"][0]["dine_in_url"]
        assert "table=1" in data["tables"][0]["dine_in_url"]
        assert "qrserver.com" in data["tables"][0]["qr_image_url"]

    def test_qr_codes_requires_owner(self, client):
        """Non-owner gets 404 from qr-codes endpoint."""
        owner_token, rid, slug, item_ids = _setup_dine_in_restaurant(client)
        other_token = _customer_token(client, "not_owner_qr@test.com")
        resp = client.get(
            f"/owner/restaurants/{rid}/qr-codes",
            headers=get_auth_header(other_token),
        )
        assert resp.status_code == 404

    def test_enable_disable_dine_in(self, client):
        """Toggle dine_in_enabled via restaurant update."""
        resp = client.post("/auth/register-owner", json={"email": "dinein_toggle@test.com", "password": "password123"})
        owner_token = resp.json()["access_token"]
        r = client.post("/owner/restaurants", json={
            "name": "Toggle Bistro",
            "city": "Test City",
            "dine_in_enabled": False,
        }, headers=get_auth_header(owner_token))
        rid = r.json()["id"]
        slug = r.json()["slug"]

        # Dine-in should be disabled
        resp = client.get(f"/dine-in/{slug}")
        assert resp.status_code == 404

        # Enable dine-in
        resp = client.put(f"/owner/restaurants/{rid}", json={
            "dine_in_enabled": True,
        }, headers=get_auth_header(owner_token))
        assert resp.status_code == 200

        # Now should work
        resp = client.get(f"/dine-in/{slug}")
        assert resp.status_code == 200

    def test_order_serialization_includes_dine_in_fields(self, client):
        """order_type and table_number included in owner order response for all orders."""
        owner_token, rid, slug, item_ids = _setup_dine_in_restaurant(client)
        token = _customer_token(client, "dinein_serial@test.com")

        # Place a dine-in order
        client.post("/dine-in/order", json={
            "restaurant_id": rid,
            "table_number": "A5",
            "items": [{"item_id": item_ids[0], "quantity": 1}],
        }, headers=get_auth_header(token))

        resp = client.get(
            f"/owner/restaurants/{rid}/orders?exclude_status=",
            headers=get_auth_header(owner_token),
        )
        orders = resp.json()
        assert len(orders) >= 1
        order = orders[0]
        assert "order_type" in order
        assert "table_number" in order
        assert order["order_type"] == "dine_in"
        assert order["table_number"] == "A5"
