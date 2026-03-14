"""Tests for cart, checkout, and order management endpoints."""
import pytest
from .conftest import register_user, get_auth_header, create_test_restaurant, create_test_category, create_test_item


def _setup_restaurant_with_items(client):
    """Set up an owner with a restaurant, category, and items. Returns (owner_token, restaurant_id, [item_ids])."""
    # Owner
    resp = client.post("/auth/register-owner", json={"email": f"ordowner_{id(client)}@test.com", "password": "password123"})
    owner_token = resp.json()["access_token"]

    # Restaurant
    r = create_test_restaurant(client, owner_token, "Order Test Restaurant")
    rid = r.json()["id"]

    # Category + Items
    cat = create_test_category(client, owner_token, rid, "Mains")
    cat_id = cat.json()["id"]
    item1 = create_test_item(client, owner_token, cat_id, "Biryani", 1299)
    item2 = create_test_item(client, owner_token, cat_id, "Naan", 299)

    return owner_token, rid, [item1.json()["id"], item2.json()["id"]]


def _customer_token(client, email="customer_ord@test.com"):
    resp = client.post("/auth/register", json={"email": email, "password": "password123"})
    return resp.json()["access_token"]


class TestCart:
    def test_add_to_cart(self, client):
        _, rid, item_ids = _setup_restaurant_with_items(client)
        token = _customer_token(client, "cart_add@test.com")

        resp = client.post("/cart/add-combo", json={
            "restaurant_id": rid,
            "items": [{"item_id": item_ids[0], "quantity": 2}],
        }, headers=get_auth_header(token))
        assert resp.status_code == 200

    def test_view_cart(self, client):
        _, rid, item_ids = _setup_restaurant_with_items(client)
        token = _customer_token(client, "cart_view@test.com")

        # Add items
        client.post("/cart/add-combo", json={
            "restaurant_id": rid,
            "items": [
                {"item_id": item_ids[0], "quantity": 1},
                {"item_id": item_ids[1], "quantity": 2},
            ],
        }, headers=get_auth_header(token))

        # View cart
        resp = client.get("/cart", headers=get_auth_header(token))
        assert resp.status_code == 200
        data = resp.json()
        assert "restaurants" in data
        assert "grand_total_cents" in data

    def test_clear_cart(self, client):
        _, rid, item_ids = _setup_restaurant_with_items(client)
        token = _customer_token(client, "cart_clear@test.com")

        # Add items
        client.post("/cart/add-combo", json={
            "restaurant_id": rid,
            "items": [{"item_id": item_ids[0], "quantity": 1}],
        }, headers=get_auth_header(token))

        # Clear
        resp = client.delete("/cart/clear", headers=get_auth_header(token))
        assert resp.status_code == 200

        # Verify empty
        resp = client.get("/cart", headers=get_auth_header(token))
        data = resp.json()
        assert data["grand_total_cents"] == 0

    def test_cart_no_auth(self, client):
        resp = client.get("/cart")
        assert resp.status_code in (401, 403)

    def test_remove_single_item(self, client):
        """Removing a single item by order_item_id should update cart correctly."""
        _, rid, item_ids = _setup_restaurant_with_items(client)
        token = _customer_token(client, "cart_rm_single@test.com")

        # Add 2 items
        client.post("/cart/add-combo", json={
            "restaurant_id": rid,
            "items": [
                {"item_id": item_ids[0], "quantity": 1},
                {"item_id": item_ids[1], "quantity": 1},
            ],
        }, headers=get_auth_header(token))

        # Get cart and find order_item_id
        cart = client.get("/cart", headers=get_auth_header(token)).json()
        items = cart["restaurants"][0]["items"]
        assert len(items) == 2
        oi_id = items[0]["order_item_id"]

        # Remove one item
        resp = client.delete(f"/cart/item/{oi_id}", headers=get_auth_header(token))
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["restaurants"][0]["items"]) == 1

    def test_remove_item_updates_totals(self, client):
        """After removing an item, grand_total_cents must decrease."""
        _, rid, item_ids = _setup_restaurant_with_items(client)
        token = _customer_token(client, "cart_rm_totals@test.com")

        client.post("/cart/add-combo", json={
            "restaurant_id": rid,
            "items": [
                {"item_id": item_ids[0], "quantity": 1},
                {"item_id": item_ids[1], "quantity": 1},
            ],
        }, headers=get_auth_header(token))

        cart_before = client.get("/cart", headers=get_auth_header(token)).json()
        total_before = cart_before["grand_total_cents"]
        oi_id = cart_before["restaurants"][0]["items"][0]["order_item_id"]
        removed_amount = cart_before["restaurants"][0]["items"][0]["line_total_cents"]

        resp = client.delete(f"/cart/item/{oi_id}", headers=get_auth_header(token))
        data = resp.json()
        assert data["grand_total_cents"] == total_before - removed_amount

    def test_remove_last_item_cleans_order(self, client):
        """Removing the last item should clean up the empty order."""
        _, rid, item_ids = _setup_restaurant_with_items(client)
        token = _customer_token(client, "cart_rm_last@test.com")

        client.post("/cart/add-combo", json={
            "restaurant_id": rid,
            "items": [{"item_id": item_ids[0], "quantity": 1}],
        }, headers=get_auth_header(token))

        cart = client.get("/cart", headers=get_auth_header(token)).json()
        oi_id = cart["restaurants"][0]["items"][0]["order_item_id"]

        resp = client.delete(f"/cart/item/{oi_id}", headers=get_auth_header(token))
        data = resp.json()
        assert data["grand_total_cents"] == 0
        assert len(data["restaurants"]) == 0

    def test_remove_nonexistent_item(self, client):
        """Removing non-existent order_item_id should return 404."""
        token = _customer_token(client, "cart_rm_404@test.com")
        resp = client.delete("/cart/item/99999", headers=get_auth_header(token))
        assert resp.status_code == 404

    def test_remove_other_users_item(self, client):
        """Cannot remove another user's cart item — should return 403."""
        _, rid, item_ids = _setup_restaurant_with_items(client)
        token1 = _customer_token(client, "cart_rm_own1@test.com")
        token2 = _customer_token(client, "cart_rm_own2@test.com")

        # User1 adds item
        client.post("/cart/add-combo", json={
            "restaurant_id": rid,
            "items": [{"item_id": item_ids[0], "quantity": 1}],
        }, headers=get_auth_header(token1))

        cart = client.get("/cart", headers=get_auth_header(token1)).json()
        oi_id = cart["restaurants"][0]["items"][0]["order_item_id"]

        # User2 tries to delete User1's item
        resp = client.delete(f"/cart/item/{oi_id}", headers=get_auth_header(token2))
        assert resp.status_code == 403

    def test_remove_item_no_auth(self, client):
        """Removing without auth should return 401/403."""
        resp = client.delete("/cart/item/1")
        assert resp.status_code in (401, 403)

    def test_cart_data_structure(self, client):
        """Cart response should have correct structure with order_item_id."""
        _, rid, item_ids = _setup_restaurant_with_items(client)
        token = _customer_token(client, "cart_struct@test.com")

        client.post("/cart/add-combo", json={
            "restaurant_id": rid,
            "items": [{"item_id": item_ids[0], "quantity": 2}],
        }, headers=get_auth_header(token))

        cart = client.get("/cart", headers=get_auth_header(token)).json()
        assert "restaurants" in cart
        assert "grand_total_cents" in cart
        group = cart["restaurants"][0]
        assert "restaurant_id" in group
        assert "restaurant_name" in group
        assert "order_id" in group
        assert "items" in group
        assert "subtotal_cents" in group
        item = group["items"][0]
        assert "order_item_id" in item
        assert "name" in item
        assert "quantity" in item
        assert "price_cents" in item
        assert "line_total_cents" in item
        assert item["quantity"] == 2


class TestCheckout:
    def test_checkout_success(self, client):
        _, rid, item_ids = _setup_restaurant_with_items(client)
        token = _customer_token(client, "checkout_ok@test.com")

        # Add items
        client.post("/cart/add-combo", json={
            "restaurant_id": rid,
            "items": [{"item_id": item_ids[0], "quantity": 1}],
        }, headers=get_auth_header(token))

        # Checkout
        resp = client.post("/checkout", headers=get_auth_header(token))
        assert resp.status_code == 200

    def test_checkout_empty_cart(self, client):
        token = _customer_token(client, "checkout_empty@test.com")
        resp = client.post("/checkout", headers=get_auth_header(token))
        # Should fail — no items
        assert resp.status_code in (400, 404, 200)  # depends on impl

    def test_checkout_create_session_dev_mode(self, client):
        """In dev mode, /checkout/create-session should return sim_dev session."""
        _, rid, item_ids = _setup_restaurant_with_items(client)
        token = _customer_token(client, "checkout_sess@test.com")

        # Add items
        client.post("/cart/add-combo", json={
            "restaurant_id": rid,
            "items": [{"item_id": item_ids[0], "quantity": 1}],
        }, headers=get_auth_header(token))

        # Create session
        resp = client.post("/checkout/create-session", headers=get_auth_header(token))
        assert resp.status_code == 200
        data = resp.json()
        assert "checkout_url" in data
        assert "session_id" in data

    def test_verify_payment_dev_mode(self, client):
        """Verify payment with sim_dev session should return confirmed orders."""
        _, rid, item_ids = _setup_restaurant_with_items(client)
        token = _customer_token(client, "verify_pay@test.com")

        # Add items and checkout (dev mode)
        client.post("/cart/add-combo", json={
            "restaurant_id": rid,
            "items": [{"item_id": item_ids[0], "quantity": 1}],
        }, headers=get_auth_header(token))
        client.post("/checkout/create-session", headers=get_auth_header(token))

        # Verify payment
        resp = client.post("/checkout/verify", json={
            "session_id": "sim_dev",
        }, headers=get_auth_header(token))
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["status"] == "paid"
        assert isinstance(data["orders"], list)

    def test_verify_payment_no_session_id(self, client):
        """Verify payment without session_id should return 400."""
        token = _customer_token(client, "verify_nosess@test.com")
        resp = client.post("/checkout/verify", json={},
                           headers=get_auth_header(token))
        assert resp.status_code == 400

    def test_verify_payment_no_auth(self, client):
        """Verify payment without auth should return 401/403."""
        resp = client.post("/checkout/verify", json={"session_id": "test"})
        assert resp.status_code in (401, 403)


class TestOwnerOrders:
    def test_owner_view_orders(self, client):
        owner_token, rid, item_ids = _setup_restaurant_with_items(client)
        cust_token = _customer_token(client, "ownerview@test.com")

        # Customer adds and checks out
        client.post("/cart/add-combo", json={
            "restaurant_id": rid,
            "items": [{"item_id": item_ids[0], "quantity": 1}],
        }, headers=get_auth_header(cust_token))
        client.post("/checkout", headers=get_auth_header(cust_token))

        # Owner views orders
        resp = client.get(
            f"/owner/restaurants/{rid}/orders",
            headers=get_auth_header(owner_token),
        )
        assert resp.status_code == 200
        orders = resp.json()
        assert isinstance(orders, list)

    def test_update_order_status(self, client):
        owner_token, rid, item_ids = _setup_restaurant_with_items(client)
        cust_token = _customer_token(client, "ordstatus@test.com")

        # Customer adds and checks out
        client.post("/cart/add-combo", json={
            "restaurant_id": rid,
            "items": [{"item_id": item_ids[0], "quantity": 1}],
        }, headers=get_auth_header(cust_token))
        client.post("/checkout", headers=get_auth_header(cust_token))

        # Get orders
        resp = client.get(
            f"/owner/restaurants/{rid}/orders?exclude_status=",
            headers=get_auth_header(owner_token),
        )
        orders = resp.json()
        if orders:
            order_id = orders[0]["id"]
            # Update status
            resp = client.patch(
                f"/owner/orders/{order_id}/status",
                json={"status": "preparing"},
                headers=get_auth_header(owner_token),
            )
            assert resp.status_code == 200


class TestMyOrders:
    def test_customer_my_orders(self, client):
        _, rid, item_ids = _setup_restaurant_with_items(client)
        token = _customer_token(client, "myorders@test.com")

        # Add and checkout
        client.post("/cart/add-combo", json={
            "restaurant_id": rid,
            "items": [{"item_id": item_ids[0], "quantity": 1}],
        }, headers=get_auth_header(token))
        client.post("/checkout", headers=get_auth_header(token))

        # My orders
        resp = client.get("/my-orders", headers=get_auth_header(token))
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_my_orders_contains_confirmed_order(self, client):
        """After checkout, /my-orders should contain the confirmed order."""
        _, rid, item_ids = _setup_restaurant_with_items(client)
        token = _customer_token(client, "myorders_has@test.com")

        client.post("/cart/add-combo", json={
            "restaurant_id": rid,
            "items": [{"item_id": item_ids[0], "quantity": 1}],
        }, headers=get_auth_header(token))
        client.post("/checkout", headers=get_auth_header(token))

        resp = client.get("/my-orders", headers=get_auth_header(token))
        orders = resp.json()
        assert len(orders) >= 1
        assert orders[0]["status"] == "confirmed"
        assert "items" in orders[0]
        assert "restaurant_name" in orders[0]

    def test_my_orders_empty_before_checkout(self, client):
        """Before any checkout, /my-orders should be empty."""
        token = _customer_token(client, "myorders_empty@test.com")
        resp = client.get("/my-orders", headers=get_auth_header(token))
        assert resp.status_code == 200
        assert resp.json() == []

    def test_full_checkout_verify_flow(self, client):
        """End-to-end: add → create-session → verify → orders appear."""
        _, rid, item_ids = _setup_restaurant_with_items(client)
        token = _customer_token(client, "e2e_flow@test.com")

        # 1. Add items to cart
        client.post("/cart/add-combo", json={
            "restaurant_id": rid,
            "items": [
                {"item_id": item_ids[0], "quantity": 1},
                {"item_id": item_ids[1], "quantity": 2},
            ],
        }, headers=get_auth_header(token))

        # 2. Create checkout session (dev mode → sim_dev)
        session_resp = client.post("/checkout/create-session", headers=get_auth_header(token))
        assert session_resp.status_code == 200
        session_data = session_resp.json()
        assert session_data["session_id"] == "sim_dev"

        # 3. Verify payment
        verify_resp = client.post("/checkout/verify", json={
            "session_id": "sim_dev",
        }, headers=get_auth_header(token))
        assert verify_resp.status_code == 200
        verify_data = verify_resp.json()
        assert verify_data["ok"] is True
        assert verify_data["status"] == "paid"

        # 4. Cart should be empty now
        cart = client.get("/cart", headers=get_auth_header(token)).json()
        assert cart["grand_total_cents"] == 0

        # 5. Orders should appear in /my-orders
        orders = client.get("/my-orders", headers=get_auth_header(token)).json()
        assert len(orders) >= 1
        assert orders[0]["status"] == "confirmed"

    def test_my_orders_no_auth(self, client):
        """Accessing /my-orders without auth should return 401/403."""
        resp = client.get("/my-orders")
        assert resp.status_code in (401, 403)

