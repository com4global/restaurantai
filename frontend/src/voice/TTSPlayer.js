/**
 * TTSPlayer.js — Sentence-chunked streaming TTS with audio buffer
 * Splits text into sentences, generates TTS for each chunk,
 * plays first sentence immediately while pre-fetching rest.
 * Uses Sarvam Bulbul v3 (Indian accent, "kavya" speaker).
 */

const DEFAULT_SPEAKER = 'kavya';
const DEFAULT_LANG = 'en-IN';
const AUDIO_BUFFER_MS = 200; // Buffer before playback to prevent glitches

/**
 * Clean text for TTS (remove markdown, emoji, etc.)
 */
function cleanForTTS(text) {
    let clean = text
        .replace(/\*\*|__|~~|`/g, '')              // Markdown
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')   // Links
        .replace(/#{1,6}\s*/g, '')                  // Headers
        .replace(/[🎤🍽️😊👋🔥📦⚠️⏳🌶️🍕🍔🍟🍣🍛🍰☕🍺🥤💧🍳🥞🧀🫔🧃🍵🍷🍸🍩🍪🍨🥧🍫🍎🍄🌽🍅✨🎙️🔊✕•]/g, '') // Emoji
        .replace(/\n+/g, '. ')                      // Newlines → periods
        .replace(/\s+/g, ' ')                       // Collapse spaces
        .trim();
    return clean;
}

/**
 * Split text into speakable sentence chunks
 * Keeps chunks between 10-150 chars for optimal TTS quality
 */
function splitIntoChunks(text) {
    // Split on sentence boundaries
    const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);

    // Merge very short sentences, split very long ones
    const chunks = [];
    let buffer = '';

    for (const sentence of sentences) {
        if (buffer.length + sentence.length < 150) {
            buffer = buffer ? buffer + ' ' + sentence : sentence;
        } else {
            if (buffer) chunks.push(buffer.trim());
            buffer = sentence;
        }
    }
    if (buffer.trim()) chunks.push(buffer.trim());

    // If no sentence breaks were found, return the whole text
    if (chunks.length === 0 && text.trim()) {
        chunks.push(text.trim().substring(0, 2000));
    }

    return chunks;
}

/**
 * Generate TTS audio for a text chunk via Sarvam API
 * @returns {Promise<string|null>} base64 audio data or null
 */
async function generateChunkAudio(apiBase, text, speaker = DEFAULT_SPEAKER, lang = DEFAULT_LANG) {
    if (!text || text.trim().length < 2) return null;

    try {
        const resp = await fetch(`${apiBase}/api/voice/tts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text.substring(0, 2000), language: lang, speaker }),
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        return data.audio_base64 || null;
    } catch {
        return null;
    }
}

/**
 * Decode base64 audio → Blob URL
 */
function decodeAudioBase64(base64) {
    const bytes = atob(base64);
    const buffer = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) buffer[i] = bytes.charCodeAt(i);
    const blob = new Blob([buffer], { type: 'audio/wav' });
    return URL.createObjectURL(blob);
}

/**
 * TTSPlayer class — manages streaming TTS playback
 */
export class TTSPlayer {
    constructor(apiBase) {
        this.apiBase = apiBase;
        this.audioEl = null;
        this.currentUrls = [];
        this.isPlaying = false;
        this.isCancelled = false;
        this.onStateChange = null; // callback: (state) => void
        this.onChunkStart = null;  // callback: (chunkIndex, totalChunks) => void
        this.onComplete = null;    // callback: () => void
    }

    /**
     * Play text with sentence-chunked streaming TTS
     * Plays first chunk ASAP while pre-fetching the rest
     */
    async speak(text, { speaker = DEFAULT_SPEAKER, lang = DEFAULT_LANG } = {}) {
        this.stop(); // Cancel any previous playback
        this.isCancelled = false;
        this.isPlaying = true;

        const clean = cleanForTTS(text);
        if (!clean) {
            this.isPlaying = false;
            this.onComplete?.();
            return;
        }

        const chunks = splitIntoChunks(clean);
        if (chunks.length === 0) {
            this.isPlaying = false;
            this.onComplete?.();
            return;
        }

        this.onStateChange?.('speaking');

        // Pre-fetch ALL chunks in parallel (but play sequentially)
        const audioPromises = chunks.map(chunk => generateChunkAudio(this.apiBase, chunk, speaker, lang));

        // Play chunks sequentially as they resolve
        for (let i = 0; i < chunks.length; i++) {
            if (this.isCancelled) break;

            const audioBase64 = await audioPromises[i];
            if (this.isCancelled || !audioBase64) continue;

            this.onChunkStart?.(i, chunks.length);
            await this._playAudioChunk(audioBase64);
        }

        // Cleanup
        this.isPlaying = false;
        this.currentUrls.forEach(url => URL.revokeObjectURL(url));
        this.currentUrls = [];

        if (!this.isCancelled) {
            this.onStateChange?.('idle');
            this.onComplete?.();
        }
    }

    /**
     * Play a single audio chunk with buffer delay
     */
    _playAudioChunk(base64) {
        return new Promise((resolve) => {
            if (this.isCancelled) { resolve(); return; }

            const url = decodeAudioBase64(base64);
            this.currentUrls.push(url);

            if (!this.audioEl) this.audioEl = new Audio();
            const audio = this.audioEl;
            audio.src = url;

            audio.onended = () => resolve();
            audio.onerror = () => resolve();

            // 200ms audio buffer before playback (prevents glitches)
            setTimeout(() => {
                if (this.isCancelled) { resolve(); return; }
                audio.play().catch(() => resolve());
            }, AUDIO_BUFFER_MS);
        });
    }

    /**
     * Stop playback immediately (for barge-in)
     */
    stop() {
        this.isCancelled = true;
        this.isPlaying = false;
        if (this.audioEl) {
            this.audioEl.pause();
            this.audioEl.currentTime = 0;
        }
        this.currentUrls.forEach(url => URL.revokeObjectURL(url));
        this.currentUrls = [];
    }

    /**
     * Destroy player and cleanup
     */
    destroy() {
        this.stop();
        this.audioEl = null;
        this.onStateChange = null;
        this.onChunkStart = null;
        this.onComplete = null;
    }
}

export default TTSPlayer;
