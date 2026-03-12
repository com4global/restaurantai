// @ts-check
const { test, expect } = require('@playwright/test');

async function loginAsCustomer(page) {
    const email = `pw_opt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.com`;
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

test.describe('Budget Optimizer', () => {
    test('should show optimizer FAB button', async ({ page }) => {
        await loginAsCustomer(page);
        await expect(page.locator('.optimizer-fab')).toBeVisible({ timeout: 5000 });
    });

    test('should open optimizer modal on click', async ({ page }) => {
        await loginAsCustomer(page);
        await page.locator('.optimizer-fab').click();
        await page.waitForTimeout(500);
        await expect(page.locator('.optimizer-modal')).toBeVisible({ timeout: 5000 });
    });

    test('should show people stepper and budget input', async ({ page }) => {
        await loginAsCustomer(page);
        await page.locator('.optimizer-fab').click();
        await page.waitForTimeout(500);
        // People stepper
        await expect(page.locator('.optimizer-stepper-value')).toBeVisible({ timeout: 3000 });
        // Budget input
        const budgetInput = page.locator('.optimizer-modal input[type="number"]').first();
        await expect(budgetInput).toBeVisible({ timeout: 3000 });
    });

    test('should adjust people count with stepper', async ({ page }) => {
        await loginAsCustomer(page);
        await page.locator('.optimizer-fab').click();
        await page.waitForTimeout(500);
        // Default is 5
        await expect(page.locator('.optimizer-stepper-value')).toHaveText('5');
        // Click + button
        await page.locator('.optimizer-modal button:has-text("+")').click();
        await expect(page.locator('.optimizer-stepper-value')).toHaveText('6');
    });
});
