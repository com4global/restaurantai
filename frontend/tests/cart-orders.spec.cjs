// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Register as a unique customer via the Profile tab.
 * Uses "Sign up" mode with a unique email per test.
 */
async function loginAsCustomer(page) {
    const uniqueEmail = `pw_cust_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.com`;

    await page.goto('/');
    await page.waitForTimeout(1500);

    // Click Profile nav tab
    await page.locator('.nav-item:has-text("Profile")').click();
    await page.waitForTimeout(500);

    // Switch to "Sign up" mode if needed
    const signUpLink = page.locator('text=/Sign up/i').first();
    if (await signUpLink.isVisible({ timeout: 2000 }).catch(() => false)) {
        await signUpLink.click();
        await page.waitForTimeout(300);
    }

    // Fill email and password
    const inputs = page.locator('input');
    await inputs.first().fill(uniqueEmail);
    await inputs.nth(1).fill('password123');
    await page.waitForTimeout(200);

    // Click "Create account" button
    const submitBtn = page.locator('button:has-text("Create account"), button:has-text("Sign in")').first();
    await submitBtn.click();
    await page.waitForTimeout(2000);

    // Click Home nav tab
    await page.locator('.nav-item:has-text("Home")').click();
    await page.waitForTimeout(1500);
}

test.describe('Customer Flow', () => {
    test('should see restaurant list on home', async ({ page }) => {
        await loginAsCustomer(page);
        await expect(page.locator('text=Order Now')).toBeVisible({ timeout: 5000 });
    });

    test('should select restaurant and see chat', async ({ page }) => {
        await loginAsCustomer(page);
        const card = page.locator('.restaurant-card-v').first();
        await expect(card).toBeVisible({ timeout: 5000 });
        await card.click();
        await page.waitForTimeout(4000);
        // Chat tab should show a restaurant name in the header
        await expect(page.locator('.chat-header-title')).toBeVisible({ timeout: 8000 });
    });

    test('should navigate to Orders tab', async ({ page }) => {
        await loginAsCustomer(page);
        // Use specific nav button to avoid matching restaurant grid text
        await page.locator('.nav-item:has-text("Orders")').click();
        await page.waitForTimeout(1000);
        await expect(page.locator('text=/Active|Completed|No orders/i').first()).toBeVisible({ timeout: 5000 });
    });
});
