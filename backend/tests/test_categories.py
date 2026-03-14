"""Tests for Category Display, Item Loading, and Menu Import Deduplication."""
import pytest
from .conftest import register_user, get_auth_header, create_test_restaurant, create_test_category, create_test_item


def _owner_token(client, email="cattest_owner@test.com"):
    resp = client.post("/auth/register-owner", json={"email": email, "password": "password123"})
    assert resp.status_code == 200
    return resp.json()["access_token"]


def _user_token(client, email="cattest_user@test.com"):
    resp = client.post("/auth/register", json={"email": email, "password": "password123"})
    assert resp.status_code == 200
    return resp.json()["access_token"]


def _setup_restaurant_with_menu(client, owner_token, name="Test Restaurant", num_categories=3, items_per_cat=2):
    """Create a restaurant with categories and items, return (restaurant_id, category_ids, item_ids)."""
    r = create_test_restaurant(client, owner_token, name)
    rid = r.json()["id"]
    cat_ids = []
    item_ids = []
    for i in range(num_categories):
        cat = create_test_category(client, owner_token, rid, f"Category {i+1}")
        cid = cat.json()["id"]
        cat_ids.append(cid)
        for j in range(items_per_cat):
            item = create_test_item(client, owner_token, cid, f"Item {i+1}-{j+1}", (i+1) * 1000 + j * 100)
            item_ids.append(item.json()["id"])
    return rid, cat_ids, item_ids


# ===== Category Listing Tests =====

class TestCategoryListing:
    def test_list_categories_returns_all(self, client):
        token = _owner_token(client, "catlist1@test.com")
        rid, cat_ids, _ = _setup_restaurant_with_menu(client, token, "Cat List Test", num_categories=5)
        resp = client.get(f"/restaurants/{rid}/categories")
        assert resp.status_code == 200
        cats = resp.json()
        assert len(cats) == 5

    def test_list_categories_empty_restaurant(self, client):
        token = _owner_token(client, "catlist2@test.com")
        r = create_test_restaurant(client, token, "Empty Menu")
        rid = r.json()["id"]
        resp = client.get(f"/restaurants/{rid}/categories")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_list_categories_has_correct_fields(self, client):
        token = _owner_token(client, "catlist3@test.com")
        rid, _, _ = _setup_restaurant_with_menu(client, token, "Field Check")
        resp = client.get(f"/restaurants/{rid}/categories")
        cats = resp.json()
        for cat in cats:
            assert "id" in cat
            assert "name" in cat
            assert isinstance(cat["id"], int)
            assert isinstance(cat["name"], str)

    def test_categories_no_duplicates(self, client):
        """Verify that listing categories returns unique entries."""
        token = _owner_token(client, "catlist4@test.com")
        rid, _, _ = _setup_restaurant_with_menu(client, token, "No Dup Check", num_categories=4)
        resp = client.get(f"/restaurants/{rid}/categories")
        cats = resp.json()
        names = [c["name"] for c in cats]
        ids = [c["id"] for c in cats]
        assert len(names) == len(set(ids)), "Category IDs should be unique"


# ===== Category Items Tests =====

class TestCategoryItems:
    def test_list_items_in_category(self, client):
        token = _owner_token(client, "catitems1@test.com")
        rid, cat_ids, _ = _setup_restaurant_with_menu(client, token, "Items Test", items_per_cat=3)
        resp = client.get(f"/categories/{cat_ids[0]}/items")
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 3

    def test_items_have_required_fields(self, client):
        token = _owner_token(client, "catitems2@test.com")
        rid, cat_ids, _ = _setup_restaurant_with_menu(client, token, "Item Fields")
        resp = client.get(f"/categories/{cat_ids[0]}/items")
        items = resp.json()
        for item in items:
            assert "id" in item
            assert "name" in item
            assert "price_cents" in item
            assert isinstance(item["price_cents"], int)

    def test_items_empty_category(self, client):
        token = _owner_token(client, "catitems3@test.com")
        r = create_test_restaurant(client, token, "Empty Cat")
        rid = r.json()["id"]
        cat = create_test_category(client, token, rid, "Empty")
        resp = client.get(f"/categories/{cat.json()['id']}/items")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_items_isolated_per_category(self, client):
        """Items from one category should not appear in another."""
        token = _owner_token(client, "catitems4@test.com")
        r = create_test_restaurant(client, token, "Isolated Items")
        rid = r.json()["id"]
        cat1 = create_test_category(client, token, rid, "Cat A")
        cat2 = create_test_category(client, token, rid, "Cat B")
        create_test_item(client, token, cat1.json()["id"], "Pizza", 999)
        create_test_item(client, token, cat2.json()["id"], "Burger", 799)

        items_a = client.get(f"/categories/{cat1.json()['id']}/items").json()
        items_b = client.get(f"/categories/{cat2.json()['id']}/items").json()
        assert len(items_a) == 1
        assert len(items_b) == 1
        assert items_a[0]["name"] == "Pizza"
        assert items_b[0]["name"] == "Burger"


# ===== Menu Import Deduplication Tests =====

class TestMenuImportDedup:
    def _import_menu(self, client, token, rid, categories):
        return client.post(
            f"/owner/restaurants/{rid}/import-menu",
            json={"categories": categories},
            headers=get_auth_header(token),
        )

    def test_import_creates_categories_and_items(self, client):
        token = _owner_token(client, "import1@test.com")
        r = create_test_restaurant(client, token, "Import Test 1")
        rid = r.json()["id"]
        resp = self._import_menu(client, token, rid, [
            {"name": "Appetizers", "items": [
                {"name": "Spring Rolls", "price_cents": 799},
                {"name": "Samosa", "price_cents": 599},
            ]},
            {"name": "Mains", "items": [
                {"name": "Biryani", "price_cents": 1499},
            ]},
        ])
        assert resp.status_code == 200
        data = resp.json()
        assert data["created"]["categories"] == 2
        assert data["created"]["items"] == 3

        # Verify via public API
        cats = client.get(f"/restaurants/{rid}/categories").json()
        assert len(cats) == 2

    def test_reimport_replaces_old_menu(self, client):
        """Re-importing a menu should replace old categories, not duplicate them."""
        token = _owner_token(client, "import2@test.com")
        r = create_test_restaurant(client, token, "Import Test 2")
        rid = r.json()["id"]

        # First import
        self._import_menu(client, token, rid, [
            {"name": "Starters", "items": [{"name": "Soup", "price_cents": 499}]},
            {"name": "Mains", "items": [{"name": "Steak", "price_cents": 2499}]},
        ])
        cats_v1 = client.get(f"/restaurants/{rid}/categories").json()
        assert len(cats_v1) == 2

        # Second import — should REPLACE, not append
        self._import_menu(client, token, rid, [
            {"name": "Appetizers", "items": [{"name": "Wings", "price_cents": 899}]},
            {"name": "Entrees", "items": [{"name": "Pasta", "price_cents": 1299}]},
            {"name": "Desserts", "items": [{"name": "Cake", "price_cents": 699}]},
        ])
        cats_v2 = client.get(f"/restaurants/{rid}/categories").json()
        assert len(cats_v2) == 3, f"Expected 3 categories after reimport, got {len(cats_v2)}"

        # Old category names should not exist
        cat_names = [c["name"] for c in cats_v2]
        assert "Starters" not in cat_names
        assert "Mains" not in cat_names
        assert "Appetizers" in cat_names
        assert "Entrees" in cat_names
        assert "Desserts" in cat_names

    def test_reimport_clears_old_items(self, client):
        """Re-importing should clear old items too."""
        token = _owner_token(client, "import3@test.com")
        r = create_test_restaurant(client, token, "Import Test 3")
        rid = r.json()["id"]

        # First import
        resp1 = self._import_menu(client, token, rid, [
            {"name": "Mains", "items": [
                {"name": "Old Item 1", "price_cents": 100},
                {"name": "Old Item 2", "price_cents": 200},
            ]},
        ])
        cat_id_v1 = client.get(f"/restaurants/{rid}/categories").json()[0]["id"]
        items_v1 = client.get(f"/categories/{cat_id_v1}/items").json()
        assert len(items_v1) == 2

        # Reimport with different items
        self._import_menu(client, token, rid, [
            {"name": "New Mains", "items": [
                {"name": "New Item 1", "price_cents": 300},
            ]},
        ])
        cats_v2 = client.get(f"/restaurants/{rid}/categories").json()
        assert len(cats_v2) == 1
        cat_id_v2 = cats_v2[0]["id"]
        items_v2 = client.get(f"/categories/{cat_id_v2}/items").json()
        assert len(items_v2) == 1
        assert items_v2[0]["name"] == "New Item 1"

    def test_import_no_auth(self, client):
        resp = client.post("/owner/restaurants/999/import-menu", json={"categories": []})
        assert resp.status_code in (401, 403)

    def test_import_wrong_restaurant(self, client):
        """Owner can't import to another owner's restaurant."""
        token1 = _owner_token(client, "import_own1@test.com")
        token2 = _owner_token(client, "import_own2@test.com")
        r = create_test_restaurant(client, token1, "Owner1 Rest")
        rid = r.json()["id"]
        resp = self._import_menu(client, token2, rid, [{"name": "Hack", "items": []}])
        assert resp.status_code == 404


# ===== Chat Flow Category Tests =====

class TestChatCategoryFlow:
    def test_process_message_returns_categories(self, client):
        """Sending #slug should return categories for the restaurant."""
        token = _user_token(client, "chatcat1@test.com")
        owner_token = _owner_token(client, "chatcat1_owner@test.com")
        r = create_test_restaurant(client, owner_token, "Chat Cat Test")
        rid = r.json()["id"]
        slug = r.json()["slug"]
        create_test_category(client, owner_token, rid, "Starters")
        create_test_category(client, owner_token, rid, "Mains")

        resp = client.post("/chat/message", json={
            "text": f"#{slug}",
            "session_id": None,
        }, headers=get_auth_header(token))
        assert resp.status_code == 200
        data = resp.json()
        assert "categories" in data
        assert len(data["categories"]) >= 2

    def test_category_command_returns_items(self, client):
        """Sending category:ID should return items for that category."""
        token = _user_token(client, "chatcat2@test.com")
        owner_token = _owner_token(client, "chatcat2_owner@test.com")
        r = create_test_restaurant(client, owner_token, "Chat Items Test")
        rid = r.json()["id"]
        slug = r.json()["slug"]
        cat = create_test_category(client, owner_token, rid, "Appetizers")
        cat_id = cat.json()["id"]
        create_test_item(client, owner_token, cat_id, "Samosa", 599)
        create_test_item(client, owner_token, cat_id, "Pakora", 699)

        # First select the restaurant
        resp1 = client.post("/chat/message", json={
            "text": f"#{slug}",
            "session_id": None,
        }, headers=get_auth_header(token))
        session_id = resp1.json()["session_id"]

        # Then select a category
        resp2 = client.post("/chat/message", json={
            "text": f"category:{cat_id}",
            "session_id": session_id,
        }, headers=get_auth_header(token))
        assert resp2.status_code == 200
        data = resp2.json()
        assert "items" in data
        assert len(data["items"]) >= 2
        item_names = [i["name"] for i in data["items"]]
        assert "Samosa" in item_names or "Pakora" in item_names
