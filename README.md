# Project 9: L'Oréal Routine Builder

L’Oréal is expanding what’s possible with AI, and now your chatbot is getting smarter. This week, you’ll upgrade it into a product-aware routine builder.

Users will be able to browse real L’Oréal brand products, select the ones they want, and generate a personalized routine using AI. They can also ask follow-up questions about their routine—just like chatting with a real advisor.

## Setup Notes (Important)

This project uses a Cloudflare Worker to call the OpenAI API.

- Do not put API keys in frontend files like `index.html`, `script.js`, or `secrets.js`.
- Keep your key only in Cloudflare Worker environment secrets.
- The app sends requests to your Worker URL, and the Worker sends requests to OpenAI.

### 1) Set your Worker secret

In your Worker settings, add:

- `OPENAI_API_KEY` = your OpenAI API key

Optional model variable:

- `OPENAI_MODEL` (if not set, Worker uses its default)

### 2) Deploy your Worker

Deploy or redeploy `worker.js` after setting secrets.

### 3) Test the app

- Open the app.
- Select one or more products.
- Click Generate Personalized Routine or send a chat message.

If you see a 500 error from the Worker, check that `OPENAI_API_KEY` is set correctly in Cloudflare and redeploy.

## Troubleshooting

### `/favicon.ico` 404

This is usually harmless browser noise. If your page already includes `data:,` as the favicon, you can ignore this.

### Worker URL returns 500

Example:

- `https://your-worker-url.workers.dev/` returns 500

Fix:

1. Confirm `OPENAI_API_KEY` exists in Worker secrets.
2. Redeploy the Worker after setting the secret.
3. Test the Worker URL again.

### `Missing OPENAI_API_KEY in Worker environment`

This means the Worker cannot find the secret at runtime.

Fix:

1. Add `OPENAI_API_KEY` to Worker secrets.
2. Make sure the key name matches exactly.
3. Redeploy and retest.

### Frontend says it cannot get a response

Example messages:

- "I couldn't get a response right now."
- "Worker request failed."

Fix:

1. Verify `WORKER_URL` in `script.js` points to your deployed Worker.
2. Open browser DevTools and check the failing network request.
3. Confirm your Worker returns JSON and not an HTML error page.

### CORS issues (blocked request)

If the browser blocks requests, verify Worker CORS headers include:

- `Access-Control-Allow-Origin`
- `Access-Control-Allow-Methods`
- `Access-Control-Allow-Headers`

Also make sure the Worker handles `OPTIONS` requests.

### Worker returns 400: unsupported `reasoning_effort`

Example message:

- `Unsupported parameter: 'reasoning_effort'. In the Responses API, this parameter has moved to 'reasoning.effort'.`

Fix:

1. Open your Worker request body in `worker.js`.
2. Remove `reasoning_effort`.
3. Use either:
   - `reasoning: { effort: "low" }` for explicit control, or
   - no `reasoning` field (API default behavior).
4. Redeploy the Worker.

### Frontend error: `normalizeCitationUrl is not defined`

Example message:

- `ReferenceError: normalizeCitationUrl is not defined`

Fix:

1. Open `script.js` and check the citation filtering function.
2. Replace `normalizeCitationUrl(...)` with the existing frontend helper `normalizeInlineUrl(...)`, or add a matching helper in `script.js`.
3. Refresh the page after saving changes.

## What Happened In This Project (Debug Notes)

This project had two real production issues while connecting the chatbot to the Worker.

### Issue A: Worker returned 500 with missing key

Symptoms:

- Browser showed `Failed to load resource: the server responded with a status of 500`.
- App error showed `Missing OPENAI_API_KEY in Worker environment.`

Root cause:

- The deployed Worker environment did not have `OPENAI_API_KEY` available at runtime.

Resolution:

1. Add `OPENAI_API_KEY` as a Worker secret in Cloudflare.
2. Ensure it is set for the active deployment environment.
3. Redeploy the Worker.

### Issue B: Worker returned 400 with unsupported parameter

Symptoms:

- App error showed:
  `Unsupported parameter: 'verbosity'. In the Responses API, this parameter has moved to 'text.verbosity'.`

Root cause:

- The Worker request body used the old top-level `verbosity` field for the Responses API.

Resolution:

1. Update Worker payload from:
   - `verbosity: "medium"`
2. To:
   - `text: { verbosity: "medium" }`
3. Redeploy the Worker.

### Issue C: Worker returned 400 for `reasoning_effort`

Symptoms:

- App error showed:
  `Unsupported parameter: 'reasoning_effort'. In the Responses API, this parameter has moved to 'reasoning.effort'.`

Root cause:

- The Worker used the deprecated `reasoning_effort` field.

Resolution:

1. Remove `reasoning_effort` from the Responses payload.
2. If reasoning control is needed, use `reasoning: { effort: "low" }`.
3. Redeploy the Worker.

### Issue D: Frontend crashed while rendering citations

Symptoms:

- Browser console showed:
  `ReferenceError: normalizeCitationUrl is not defined`

Root cause:

- `script.js` called a citation helper that existed in the Worker file but not in frontend code.

Resolution:

1. Update citation filtering to use frontend helper `normalizeInlineUrl(...)`.
2. Keep frontend and Worker utility names consistent when sharing logic.
3. Refresh and retest routine generation/chat.

### Final stable state

- Frontend calls only the Worker endpoint.
- Worker reads API key from `OPENAI_API_KEY` environment secret.
- Responses API call uses `text.verbosity`.
- Worker payload does not use deprecated `reasoning_effort`.
- Frontend citation filtering uses helpers that exist in `script.js`.

## Project Updates: L’Oréal AI Product Advisor

This project was updated from a basic chatbot into a branded, catalog-aware L’Oréal beauty advisor powered by a Cloudflare Worker and the Groq API.

### Key Features Added

- Built a branded L’Oréal chatbot experience for skincare, haircare, makeup, fragrance, and personalized routine recommendations.
- Added a responsive chat interface with separate user and assistant message bubbles.
- Added product selection functionality so users can choose products and generate a personalized routine from those selections.
- Added conversation history so the chatbot can respond with more context during a session.
- Added a product catalog grounding system so the chatbot only recommends products from the project’s `products.json` file.
- Added polite refusal behavior for unrelated questions outside beauty, L’Oréal products, routines, or recommendations.
- Added search and category filtering to help users browse the product catalog.
- Added selected-product persistence using `localStorage`, so product selections remain after refreshing the page.
- Added product detail modal support for viewing more information about individual products.
- Added basic multilingual layout support by detecting right-to-left language settings.

### API and Security Changes

Originally, the project used an OpenAI API setup. The API key expired, so the project was migrated to the Groq API.

The frontend now sends requests to a Cloudflare Worker instead of calling an AI API directly from the browser. This protects the API key and follows a better production-style pattern.

The request flow is:

```txt
Frontend website
    ↓
script.js
    ↓
Cloudflare Worker
    ↓
Groq API
    ↓
Catalog-restricted chatbot response