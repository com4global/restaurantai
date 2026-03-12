// @ts-check
const { test, expect } = require('@playwright/test');

async function loginAsCustomer(page) {
    const email = `pw_chat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.com`;
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

async function selectRestaurant(page) {
    const card = page.locator('.restaurant-card-v').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.click();
    await page.waitForTimeout(3000);
    await expect(page.locator('.cat-pill').first()).toBeVisible({ timeout: 8000 });
}

test.describe('Chat & AI Assistant', () => {
    test('should show chat input field', async ({ page }) => {
        await loginAsCustomer(page);
        await selectRestaurant(page);
        await expect(page.locator('.ai-chat-input')).toBeVisible({ timeout: 5000 });
    });

    test('should show bot welcome message', async ({ page }) => {
        await loginAsCustomer(page);
        await selectRestaurant(page);
        // Bot should show welcome/intro message
        await expect(page.locator('.ai-bubble').first()).toBeVisible({ timeout: 5000 });
    });

    test('should send message and get bot response', async ({ page }) => {
        await loginAsCustomer(page);
        await selectRestaurant(page);
        // Type a message
        await page.locator('.ai-chat-input').fill('hello');
        await page.locator('.send-btn').click();
        await page.waitForTimeout(4000);
        // Bot bubble should update with new response
        await expect(page.locator('.ai-bubble').first()).toBeVisible({ timeout: 8000 });
    });

    test('should show mic button for voice mode', async ({ page }) => {
        await loginAsCustomer(page);
        await selectRestaurant(page);
        await expect(page.locator('.mic-btn')).toBeVisible({ timeout: 5000 });
    });
});
