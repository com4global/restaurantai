// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Register a unique customer and go to Home.
 */
async function loginAsCustomer(page) {
    const email = `pw_addcart_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.com`;
    await page.goto('/');
    await page.waitForTimeout(1500);
    await page.locator('.nav-item:has-text("Profile")').click();
    await page.waitForTimeout(500);
    const signUp = page.locator('text=/Sign up/i').first();
    if (await signUp.isVisible({ timeout: 2000 }).catch(() => false)) {
        await signUp.click();
        await page.waitForTimeout(300);
    }
    await page.locator('input').first().fill(email);
    await page.locator('input').nth(1).fill('password123');
    await page.locator('button').filter({ hasText: /Create account|Sign in/i }).first().click();
    await page.waitForTimeout(2000);
    await page.locator('.nav-item:has-text("Home")').click();
    await page.waitForTimeout(1500);
}

/**
 * Select first restaurant and wait for chat to load.
 */
async function selectRestaurant(page) {
    const card = page.locator('.restaurant-card-v').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.click();
    await page.waitForTimeout(3000);
    await expect(page.locator('.cat-pill').first()).toBeVisible({ timeout: 8000 });
}

test.describe('Add Item to Cart', () => {
    test('should click category and see menu items', async ({ page }) => {
        await loginAsCustomer(page);
        await selectRestaurant(page);
        // Click first category pill
        await page.locator('.cat-pill').first().click();
        await page.waitForTimeout(3000);
        // Menu items should appear
        await expect(page.locator('.menu-item').first()).toBeVisible({ timeout: 8000 });
    });

    test('should add item and see cart button appear', async ({ page }) => {
        await loginAsCustomer(page);
        await selectRestaurant(page);
        // Click first category
        await page.locator('.cat-pill').first().click();
        await page.waitForTimeout(3000);
        // Wait for menu items
        await expect(page.locator('.menu-item').first()).toBeVisible({ timeout: 8000 });
        // Click the + button on first item
        await page.locator('.menu-add-btn').first().click();
        await page.waitForTimeout(2000);
        // Cart button should now appear in header with a price
        await expect(page.locator('.chat-cart-btn')).toBeVisible({ timeout: 8000 });
    });

    test('should show item name and price in menu', async ({ page }) => {
        await loginAsCustomer(page);
        await selectRestaurant(page);
        await page.locator('.cat-pill').first().click();
        await page.waitForTimeout(3000);
        await expect(page.locator('.menu-item').first()).toBeVisible({ timeout: 8000 });
        // Item should have a name and price
        await expect(page.locator('.menu-item-name').first()).toBeVisible();
        await expect(page.locator('.menu-item-price').first()).toBeVisible();
    });
});
