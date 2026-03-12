// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Navigate to owner portal, register, start trial, and create a restaurant.
 * Fills all required fields including City.
 */
async function setupOwner(page) {
    const email = `pw_ownerord_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.com`;
    await page.goto('/');
    await page.waitForTimeout(1000);
    await page.locator('text=Profile').click();
    await page.waitForTimeout(1000);
    await page.locator('text=/restaurant owner/i').click();
    await page.waitForTimeout(1000);

    // Register
    const inputs = page.locator('input');
    await inputs.first().fill(email);
    await inputs.nth(1).fill('password123');
    await page.locator('button').first().click();
    await page.waitForTimeout(3000);

    // Start trial
    const trial = page.locator('text=/start free trial/i').first();
    if (await trial.isVisible({ timeout: 3000 }).catch(() => false)) {
        await trial.click();
        await page.waitForTimeout(2000);
    }

    // Create restaurant — fill ALL required fields
    const addBtn = page.locator('text=/add restaurant/i').first();
    if (await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await addBtn.click();
        await page.waitForTimeout(500);
        // Fill Restaurant Name (first input)
        const formInputs = page.locator('input');
        await formInputs.first().fill('Order Test Rest');
        // Fill City (second input — it's required)
        await formInputs.nth(1).fill('TestCity');
        // Click Create Restaurant button
        await page.locator('button:has-text("Create Restaurant")').click();
        await page.waitForTimeout(3000);
    }
}

test.describe('Owner Order Management', () => {
    test('should see Orders tab for restaurant', async ({ page }) => {
        await setupOwner(page);
        const ordersTab = page.locator('text=/Orders/').first();
        await expect(ordersTab).toBeVisible({ timeout: 8000 });
    });

    test('should click Orders tab and see Active/Archived sub-tabs', async ({ page }) => {
        await setupOwner(page);
        await page.locator('text=/📋 Orders/').first().click();
        await page.waitForTimeout(1000);
        await expect(page.locator('text=/Active/').first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('text=/Archived/').first()).toBeVisible({ timeout: 5000 });
    });

    test('should show empty state when no orders', async ({ page }) => {
        await setupOwner(page);
        await page.locator('text=/📋 Orders/').first().click();
        await page.waitForTimeout(1000);
        const emptyState = page.locator('text=/no.*order|waiting|empty/i').first();
        await expect(emptyState).toBeVisible({ timeout: 5000 });
    });

    test('should see Menu tab for restaurant', async ({ page }) => {
        await setupOwner(page);
        const menuTab = page.locator('text=Menu').first();
        await expect(menuTab).toBeVisible({ timeout: 5000 });
    });
});
