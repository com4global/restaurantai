# Future Implementation Ideas

## 1. Expand Local Intent Parsing (The Absolute Safest Route)
Right now, the frontend has `frontend/src/voice/IntentParser.js`. We can expand this file to aggressively intercept hundreds of standard food-ordering phrases locally on the user's device. 

For example, if the app sees the text "add [exact menu item name]", it automatically fires the `add:ID` fast-path we built. This costs 0 tokens, has 0 latency, and is 100% immune to LLM hallucinations because it uses standard code logic! The LLM acts purely as a "safety net" for complex or weird phrases that the local code can't understand.

**Recommendation:** By giving `IntentParser.js` a lightweight list of the restaurant's menu items, the frontend can locally match 80% of normal user commands instantly. We reserve the expensive LLM calls only for multiple-restaurant orders, meal planning, and highly complex conversational requests.
