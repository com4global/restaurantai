#!/usr/bin/env python3
"""
Quick smoke test: login (JSON) + one chat message.
Run with backend up: python scripts/test_login_chat.py
Override base URL: BASE_URL=http://127.0.0.1:8000 python scripts/test_login_chat.py
"""
import json
import os
import urllib.request
import urllib.error

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:8000")
EMAIL = "testvoice@test.com"
PASSWORD = "test1234"


def api(path, data=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(f"{BASE}{path}", data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode()), resp.status
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        print(f"HTTP {e.code}: {err[:300]}")
        return {}, e.code
    except urllib.error.URLError as e:
        print(f"URL error: {e.reason}")
        return {}, 0


def main():
    print(f"Base URL: {BASE}\n")

    # 1. Login (JSON body)
    print("1. Login (JSON)...")
    res, status = api("/auth/login", {"email": EMAIL, "password": PASSWORD})
    if status != 200:
        print("   Login failed, trying register...")
        res, status = api("/auth/register", {"email": EMAIL, "password": PASSWORD})
    if status != 200:
        print("   FAIL: could not get token")
        return 1
    token = res.get("access_token", "")
    if not token:
        print("   FAIL: no access_token in response")
        return 1
    print(f"   OK (token: {token[:20]}...)\n")

    # 2. One chat message (simulate voice "hello")
    print("2. Chat message (text: 'hello')...")
    res, status = api("/chat/message", {"session_id": None, "text": "hello"}, token)
    if status != 200:
        print("   FAIL: chat returned", status)
        return 1
    reply = (res.get("reply") or "")[:120]
    voice_prompt = (res.get("voice_prompt") or "")[:80]
    print(f"   OK")
    print(f"   reply: {reply}...")
    print(f"   voice_prompt: {voice_prompt}...")
    print(f"   session_id: {res.get('session_id')}\n")

    print("Smoke test passed.")
    return 0


if __name__ == "__main__":
    exit(main())
