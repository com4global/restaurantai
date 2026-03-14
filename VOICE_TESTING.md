# Voice testing (Restaurant AI)

## Quick API smoke test

With the backend running (e.g. on port 8000):

```bash
cd restaurantai
python scripts/test_login_chat.py
```

Optional: use a different base URL:

```bash
BASE_URL=http://127.0.0.1:8000 python scripts/test_login_chat.py
```

## Manual voice testing in the browser

1. **Start backend and frontend**
   - Backend: `cd restaurantai/backend && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000`
   - Frontend: `cd restaurantai/frontend && npm run dev` (serves on http://localhost:5173)

2. **Open the app**
   - Go to http://localhost:5173 (use Chrome for best speech recognition support).

3. **Log in** (or register) so the chat/voice APIs have a valid token.

4. **Use the voice / mic**
   - Turn on the mic/voice mode in the UI.
   - Say something short (e.g. “hello” or a restaurant name). After you stop talking, the app should send the transcript and show a reply (and optionally play TTS).

5. **If it stays on “listening” and never responds**
   - Confirm backend is up and reachable (run `scripts/test_login_chat.py`).
   - Open DevTools (F12) → Console. Look for:
     - `[Voice]` logs (e.g. “Final transcript”, “Sending to doSend”, “doSend completed”).
     - Any red errors (e.g. CORS, 401, 500).
   - Ensure you’re on **Chrome** (Speech Recognition works best there).
   - After ~12 seconds the app should auto-resume listening (safety timeout); if you see “Safety timeout — resuming listening”, the backend or `doSend` likely didn’t complete.

## Full voice flow (script)

End-to-end voice-style flow (login → select restaurant → categories → items):

```bash
cd restaurantai
python test_voice_flow.py
```

Uses `localhost:8000` by default; ensure backend is running first.
