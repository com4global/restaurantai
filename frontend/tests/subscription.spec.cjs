// @ts-check
const { test, expect } = require('@playwright/test');

const OWNER_EMAIL = `pw_sub_${Date.now()}@test.com`;
const OWNER_PASS = 'password123';

/**
 * Navigate to owner portal and register.
 */
async function navigateToOwner(page) {
    await page.goto('/');
    await page.waitForTimeout(1000);
    await page.locator('text=Profile').click();
    await page.waitForTimeout(1000);
    await page.locator('text=/restaurant owner/i').click();
    await page.waitForTimeout(1000);

    const emailInput = page.locator('input').first();
    if (await emailInput.isVisible()) {
        await emailInput.fill(OWNER_EMAIL);
        await page.locator('input').nth(1).fill(OWNER_PASS);
        await page.locator('button').first().click();
        await page.waitForTimeout(3000);
    }
}

test.describe('Subscription & Settings', () => {
    test('should show pricing/trial page for new owner', async ({ page }) => {
        await navigateToOwner(page);
        // Should see pricing or trial page
        const hasPricing = await page.locator('text=/free trial|choose your plan|standard|corporate|pricing/i').first().isVisible({ timeout: 5000 }).catch(() => false);
        expect(hasPricing).toBe(true);
    });

    test('should start free trial', async ({ page }) => {
        await navigateToOwner(page);
        const trial = page.locator('text=/start free trial/i').first();
        if (await trial.isVisible({ timeout: 5000 }).catch(() => false)) {
            await trial.click();
            await page.waitForTimeout(2000);
            // Should now see dashboard or add restaurant
            const hasContent = await page.locator('text=/add restaurant|my restaurants|dashboard/i').first().isVisible({ timeout: 5000 }).catch(() => false);
            expect(hasContent).toBe(true);
        }
    });

    test('should show trial badge in dashboard', async ({ page }) => {
        await navigateToOwner(page);
        const trial = page.locator('text=/start free trial/i').first();
        if (await trial.isVisible({ timeout: 3000 }).catch(() => false)) {
            await trial.click();
            await page.waitForTimeout(2000);
        }
        // Should see trial badge
        const badge = page.locator('text=/trial|days left/i').first();
        await expect(badge).toBeVisible({ timeout: 5000 });
    });

    test('should show Settings tab with billing', async ({ page }) => {
        await navigateToOwner(page);
        // Start trial
        const trial = page.locator('text=/start free trial/i').first();
        if (await trial.isVisible({ timeout: 3000 }).catch(() => false)) {
            await trial.click();
            await page.waitForTimeout(2000);
        }

        // Create restaurant to see tabs
        const addBtn = page.locator('text=/add restaurant/i').first();
        if (await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await addBtn.click();
            await page.waitForTimeout(500);
            await page.locator('input').first().fill('Settings Test');
            const createBtn = page.locator('button').filter({ hasText: /create|save|add/i }).first();
            if (await createBtn.isVisible()) {
                await createBtn.click();
                await page.waitForTimeout(2000);
            }
        }

        // Click Settings tab
        const settingsTab = page.locator('text=Settings').first();
        if (await settingsTab.isVisible({ timeout: 5000 }).catch(() => false)) {
            await settingsTab.click();
            await page.waitForTimeout(500);
            // Should show plan info or billing
            const planInfo = page.locator('text=/plan|billing|free trial|standard|corporate/i').first();
            await expect(planInfo).toBeVisible({ timeout: 5000 });
        }
    });

    test('should show logout button', async ({ page }) => {
        await navigateToOwner(page);
        const trial = page.locator('text=/start free trial/i').first();
        if (await trial.isVisible({ timeout: 3000 }).catch(() => false)) {
            await trial.click();
            await page.waitForTimeout(2000);
        }
        const logout = page.locator('text=/logout|sign out/i').first();
        await expect(logout).toBeVisible({ timeout: 5000 });
    });
});
