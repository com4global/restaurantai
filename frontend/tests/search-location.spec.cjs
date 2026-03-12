// @ts-check
const { test, expect } = require('@playwright/test');

async function loginAsCustomer(page) {
    const email = `pw_search_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.com`;
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

test.describe('Search & Location', () => {
    test('should show search bar on home', async ({ page }) => {
        await loginAsCustomer(page);
        await expect(page.locator('.search-bar')).toBeVisible({ timeout: 5000 });
    });

    test('should show zip code input', async ({ page }) => {
        await loginAsCustomer(page);
        await expect(page.locator('.loc-zip-input')).toBeVisible({ timeout: 5000 });
    });

    test('should show GPS button', async ({ page }) => {
        await loginAsCustomer(page);
        await expect(page.locator('.loc-gps-btn')).toBeVisible({ timeout: 5000 });
    });

    test('should show radius selector', async ({ page }) => {
        await loginAsCustomer(page);
        const select = page.locator('.loc-radius-select');
        await expect(select).toBeVisible({ timeout: 5000 });
        // Should have radius options
        const optionCount = await select.locator('option').count();
        expect(optionCount).toBeGreaterThan(2);
    });

    test('should type in search bar', async ({ page }) => {
        await loginAsCustomer(page);
        const searchInput = page.locator('.search-bar input');
        await expect(searchInput).toBeVisible({ timeout: 5000 });
        await searchInput.fill('pizza');
        await page.waitForTimeout(500);
        // Value should be filled
        await expect(searchInput).toHaveValue('pizza');
    });
});
