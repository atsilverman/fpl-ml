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
