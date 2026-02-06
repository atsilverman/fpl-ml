# price-changes-ingest

Edge Function for the Price Changes screenshot pipeline. Accepts OCR text from the iOS Shortcut, structures it via OpenAI, and inserts into `price_change_predictions`.

## Secrets (set via Supabase Dashboard or `supabase secrets set`)

- **PRICE_CHANGES_INGEST_SECRET** – Bearer token or x-api-key value the Shortcut sends. If unset, auth is skipped (not recommended in production).
- **OPENAI_API_KEY** – OpenAI API key for GPT (e.g. gpt-4o-mini).

## Request

- **Method:** POST
- **Headers:** `Content-Type: application/json`, `Authorization: Bearer <PRICE_CHANGES_INGEST_SECRET>` (or `x-api-key`)
- **Body:** `{ "text": "raw OCR text from screenshot" }`

## Response

- **200:** `{ "id": "<uuid>" }`
- **4xx/5xx:** `{ "error": "...", "details": "..." }`

## Local run

From project root (or where `supabase` is configured):

```bash
supabase functions serve price-changes-ingest --env-file ./supabase/.env.local --no-verify-jwt
```

`.env.local` should contain `PRICE_CHANGES_INGEST_SECRET` and `OPENAI_API_KEY`.

## If it stops writing to the table

1. **Redeploy** so the latest code and logging are live:
   ```bash
   supabase functions deploy price-changes-ingest
   ```

2. **Check the Shortcut response** – If the request returns 4xx/5xx, the body will include `error` and often `details` or `code` (e.g. "Failed to save predictions", "Unauthorized", "OPENAI_API_KEY not set").

3. **Check Edge Function logs** – Supabase Dashboard → your project → Edge Functions → `price-changes-ingest` → Logs. Look for:
   - `Request: POST` and `Body text length: N` → request reached the function.
   - `Parsed rises: X falls: Y` → OpenAI and parsing succeeded.
   - `Inserted id: <uuid>` → row was written.
   - `Supabase insert error:` or `Insert threw:` → failure at DB; the response body will have the same details.

4. **Confirm secrets** – In Supabase, Edge Function secrets must include `PRICE_CHANGES_INGEST_SECRET`, `OPENAI_API_KEY`. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are usually auto-injected; if your function runs in a context where they are not, add them to secrets.
