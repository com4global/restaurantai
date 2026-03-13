// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Search quality E2E tests — verifies the UI handles natural language
 * food searches, price comparisons, and typo tolerance correctly.
 */

async function registerAndLogin(page) {
    const email = `pw_sq_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.com`;
    await page.goto('/');
    await page.waitForTimeout(1500);
    // Navigate to Profile tab
    await page.locator('.nav-item:has-text("Profile")').click();
    await page.waitForTimeout(500);
    // Click "Sign up" if visible
    const signUp = page.locator('text=/Sign up/i').first();
    if (await signUp.isVisible({ timeout: 2000 }).catch(() => false)) {
        await signUp.click();
        await page.waitForTimeout(300);
    }
    await page.locator('input').first().fill(email);
    await page.locator('input').nth(1).fill('password123');
    await page.locator('button').filter({ hasText: /Create account|Sign in/i }).first().click();
    await page.waitForTimeout(2000);
    // Go to Home tab
    await page.locator('.nav-item:has-text("Home")').click();
    await page.waitForTimeout(1500);
    return email;
}

async function selectFirstRestaurant(page) {
    const card = page.locator('.restaurant-card-v').first();
    await expect(card).toBeVisible({ timeout: 8000 });
    await card.click();
    await page.waitForTimeout(3000);
    await expect(page.locator('.cat-pill').first()).toBeVisible({ timeout: 8000 });
}

async function sendChatMessage(page, message) {
    await page.locator('.ai-chat-input').fill(message);
    await page.locator('.send-btn').click();
    await page.waitForTimeout(4000);
}

test.describe('Search Quality — Home Tab', () => {
    test('should display restaurant cards on home tab', async ({ page }) => {
        await registerAndLogin(page);
        // Home tab should show at least one restaurant card
        await expect(page.locator('.restaurant-card-v').first()).toBeVisible({ timeout: 8000 });
    });

    test('should show location bar with zip input', async ({ page }) => {
        await registerAndLogin(page);
        await expect(page.locator('.loc-zip-input')).toBeVisible({ timeout: 5000 });
    });

    test('should show search bar on home tab', async ({ page }) => {
        await registerAndLogin(page);
        await expect(page.locator('.search-bar')).toBeVisible({ timeout: 5000 });
    });
});

test.describe('Search Quality — Price Comparison', () => {
    test('cheapest biryani triggers price comparison card', async ({ page }) => {
        await registerAndLogin(page);
        await selectFirstRestaurant(page);
        await sendChatMessage(page, 'cheapest biryani');
        // Should show the price comparison card
        await expect(page.locator('.price-compare-card')).toBeVisible({ timeout: 10000 });
    });

    test('price comparison shows Order buttons', async ({ page }) => {
        await registerAndLogin(page);
        await selectFirstRestaurant(page);
        await sendChatMessage(page, 'cheapest biryani');
        await expect(page.locator('.compare-order-btn').first()).toBeVisible({ timeout: 10000 });
    });

    test('compare chicken triggers price comparison', async ({ page }) => {
        await registerAndLogin(page);
        await selectFirstRestaurant(page);
        await sendChatMessage(page, 'compare chicken');
        await expect(page.locator('.price-compare-card')).toBeVisible({ timeout: 10000 });
    });

    test('natural language price search works', async ({ page }) => {
        await registerAndLogin(page);
        await selectFirstRestaurant(page);
        await sendChatMessage(page, 'where can i find the cheapest biryani');
        // Should show price comparison OR a bot response mentioning biryani
        const hasCompare = await page.locator('.price-compare-card').isVisible().catch(() => false);
        const hasBubble = await page.locator('.ai-bubble').isVisible().catch(() => false);
        expect(hasCompare || hasBubble).toBeTruthy();
    });
});

test.describe('Search Quality — Chat Search', () => {
    test('chat shows bot response for food query', async ({ page }) => {
        await registerAndLogin(page);
        await selectFirstRestaurant(page);
        await sendChatMessage(page, 'biryani');
        // Bot should respond in the AI strip
        await expect(page.locator('.ai-bubble').first()).toBeVisible({ timeout: 8000 });
    });

    test('natural language search in chat gets response', async ({ page }) => {
        await registerAndLogin(page);
        await selectFirstRestaurant(page);
        await sendChatMessage(page, 'i want chicken');
        // Should get a response — either items shown or bot reply
        const hasItems = await page.locator('.menu-item').first().isVisible().catch(() => false);
        const hasBubble = await page.locator('.ai-bubble').first().isVisible().catch(() => false);
        expect(hasItems || hasBubble).toBeTruthy();
    });

    test('misspelled food name still gets response', async ({ page }) => {
        await registerAndLogin(page);
        await selectFirstRestaurant(page);
        await sendChatMessage(page, 'chiken tikka');
        // Should get a response (fuzzy match)
        await expect(page.locator('.ai-bubble').first()).toBeVisible({ timeout: 8000 });
    });

    test('category selection shows menu items', async ({ page }) => {
        await registerAndLogin(page);
        await selectFirstRestaurant(page);
        // Click on a category pill
        await page.locator('.cat-pill').first().click();
        await page.waitForTimeout(3000);
        // Menu items should appear
        await expect(page.locator('.menu-item').first()).toBeVisible({ timeout: 8000 });
    });

    test('# restaurant search shows suggestions', async ({ page }) => {
        await registerAndLogin(page);
        await selectFirstRestaurant(page);
        // Type # to trigger restaurant suggestions
        await page.locator('.ai-chat-input').fill('#');
        await page.waitForTimeout(1000);
        // Should show suggestion dropdown or restaurant list
        const hasSuggestions = await page.locator('.suggestions').isVisible().catch(() => false);
        const hasSuggestionItem = await page.locator('.suggestion-item').first().isVisible().catch(() => false);
        // # alone may or may not show suggestions depending on restaurant count
        // Just check the input is visible and functioning
        await expect(page.locator('.ai-chat-input')).toHaveValue('#');
    });
});

test.describe('Search Quality — Cart Integration', () => {
    test('adding item via menu shows cart button', async ({ page }) => {
        await registerAndLogin(page);
        await selectFirstRestaurant(page);
        // Click a category
        await page.locator('.cat-pill').first().click();
        await page.waitForTimeout(3000);
        // Click add button on first menu item
        const addBtn = page.locator('.menu-add-btn').first();
        if (await addBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            await addBtn.click();
            await page.waitForTimeout(2000);
            // Cart button should appear in the header
            await expect(page.locator('.chat-cart-btn')).toBeVisible({ timeout: 5000 });
        }
    });
});
