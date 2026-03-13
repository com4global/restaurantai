// @ts-check
const { test, expect } = require('@playwright/test');

// ─── Helpers ────────────────────────────────────────────────────────────────

async function loginAndGoToChat(page) {
    const email = `pw_voice_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.com`;
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
    // Navigate to Chat tab
    await page.locator('.nav-item:has-text("Chat")').click();
    await page.waitForTimeout(1000);
}

/**
 * Inject mocks for getUserMedia, SpeechSynthesis, and SpeechRecognition.
 * Must be called BEFORE page.goto() since addInitScript runs before page JS.
 */
async function injectVoiceMocks(page) {
    await page.addInitScript(() => {
        // Mock getUserMedia — resolve with fake stream
        navigator.mediaDevices.getUserMedia = async () => ({
            getTracks: () => [{ stop: () => { } }],
        });

        // Mock SpeechSynthesis — immediately fire onend
        const origSS = window.speechSynthesis;
        window.speechSynthesis = Object.assign(origSS || {}, {
            cancel: () => { },
            speak: (u) => { setTimeout(() => { if (u.onend) u.onend(new Event('end')); }, 100); },
            speaking: false, pending: false, paused: false,
            getVoices: () => [], addEventListener: () => { },
        });

        // Mock SpeechRecognition
        class MockSR {
            constructor() {
                this.lang = 'en-US';
                this.continuous = false;
                this.interimResults = false;
                this.maxAlternatives = 1;
                this.onstart = null;
                this.onresult = null;
                this.onerror = null;
                this.onend = null;
            }
            start() {
                if (this.onstart) setTimeout(() => this.onstart(), 50);
                const self = this;
                // Simulate 'no-speech' after 1.5s (keeps voice mode alive via auto-restart)
                setTimeout(() => {
                    if (self.onerror) self.onerror({ error: 'no-speech' });
                    if (self.onend) self.onend();
                }, 1500);
            }
            stop() { if (this.onend) this.onend(); }
            abort() { }
        }
        window.SpeechRecognition = MockSR;
        window.webkitSpeechRecognition = MockSR;
    });
}

/** Inject mock that DENIES microphone permission */
async function injectDeniedMicMock(page) {
    await page.addInitScript(() => {
        navigator.mediaDevices.getUserMedia = async () => {
            throw new DOMException('Permission denied', 'NotAllowedError');
        };
        class MockSR {
            constructor() { this.onstart = null; this.onerror = null; this.onend = null; }
            start() { }
            stop() { }
            abort() { }
        }
        window.SpeechRecognition = MockSR;
        window.webkitSpeechRecognition = MockSR;
    });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test.describe('Voice Input', () => {
    test.use({ permissions: ['microphone'] });

    test('should show mic button on Chat tab', async ({ page }) => {
        await loginAndGoToChat(page);

        const micBtn = page.locator('.mic-btn');
        await expect(micBtn).toBeVisible({ timeout: 5000 });
        await expect(micBtn).toContainText('🎤');
    });

    test('should toggle voice mode on and off', async ({ page }) => {
        await injectVoiceMocks(page);
        await loginAndGoToChat(page);

        const micBtn = page.locator('.mic-btn');
        await expect(micBtn).toBeVisible({ timeout: 5000 });

        // Activate voice mode
        await micBtn.click();
        await page.waitForTimeout(2000);

        // Mic should be active with status bar visible
        await expect(micBtn).toHaveClass(/voice-active/, { timeout: 5000 });
        await expect(micBtn).toContainText('🔴');
        await expect(page.locator('.voice-status-bar')).toBeVisible({ timeout: 3000 });

        // Deactivate
        await micBtn.click();
        await page.waitForTimeout(500);

        await expect(micBtn).not.toHaveClass(/voice-active/);
        await expect(micBtn).toContainText('🎤');
        await expect(page.locator('.voice-status-bar')).not.toBeVisible();
    });

    test('should show end button in status bar', async ({ page }) => {
        await injectVoiceMocks(page);
        await loginAndGoToChat(page);

        const micBtn = page.locator('.mic-btn');
        await micBtn.click();
        await page.waitForTimeout(2000);

        const endBtn = page.locator('.voice-end-btn');
        await expect(endBtn).toBeVisible({ timeout: 3000 });

        await endBtn.click();
        await page.waitForTimeout(500);

        await expect(micBtn).not.toHaveClass(/voice-active/);
    });

    test('should update placeholder in voice mode', async ({ page }) => {
        await injectVoiceMocks(page);
        await loginAndGoToChat(page);

        const chatInput = page.locator('.ai-chat-input');
        const defaultPlaceholder = await chatInput.getAttribute('placeholder');
        expect(defaultPlaceholder).toContain('restaurant');

        const micBtn = page.locator('.mic-btn');
        await micBtn.click();
        await page.waitForTimeout(2000);

        const voicePlaceholder = await chatInput.getAttribute('placeholder');
        expect(voicePlaceholder).toContain('Voice active');

        await micBtn.click();
        await page.waitForTimeout(500);

        const reverted = await chatInput.getAttribute('placeholder');
        expect(reverted).toContain('restaurant');
    });

    test('should block voice mode when mic is denied', async ({ page }) => {
        await injectDeniedMicMock(page);
        await loginAndGoToChat(page);

        const micBtn = page.locator('.mic-btn');
        await micBtn.click();
        await page.waitForTimeout(1500);

        // Voice mode should NOT activate
        await expect(micBtn).not.toHaveClass(/voice-active/);
        await expect(micBtn).toContainText('🎤');
    });
});
