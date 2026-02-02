# Price Changes iOS Shortcut

Use this Shortcut to send screenshot OCR text to the Price Changes ingest API. Run it from the **Share** sheet after taking a screenshot of your price-change source.

## Prerequisites

- iOS 15+ (for **Extract Text from Image** / Live Text).
- Edge Function deployed and secrets set: `PRICE_CHANGES_INGEST_SECRET`, `OPENAI_API_KEY`.
- Your Edge Function URL: `https://<project-ref>.supabase.co/functions/v1/price-changes-ingest`.

## Shortcut steps

1. **Get Latest Screenshots**
   - Actions → Photos → **Get Latest Screenshots**.
   - Set **Count** to 1 (or use **Get Last Photo** with **Include Screenshots** on).

2. **Extract Text from Image**
   - Actions → **Extract Text from Image** (search “Extract Text” or “Text from Image”).
   - Input: pass the image from step 1 (usually “Latest Screenshots” or “Last Photo”).

3. **Get Contents of URL**
   - Actions → Web → **Get Contents of URL**.
   - **URL:** your Edge Function URL (e.g. `https://xxxx.supabase.co/functions/v1/price-changes-ingest`).
   - **Method:** POST (tap “Get” and change to “POST”).
   - **Headers:** add:
     - `Content-Type` = `application/json`
     - `Authorization` = `Bearer YOUR_SECRET` (use the same value as `PRICE_CHANGES_INGEST_SECRET`).  
     Alternatively use header `x-api-key` = `YOUR_SECRET`.
   - **Request Body:** JSON.
     - In the JSON body, add a key `text` and set its value to the **output of “Extract Text from Image”** (drag the variable from step 2 into the value).

4. **Optional: Show result**
   - Add **Show Result** or **Show Alert** and pass the **Contents of URL** result so you see “Done” or the response.

## How to run

- **From Share sheet (recommended):** Take a screenshot → tap the screenshot preview → **Share** → **Run Shortcut** → choose this Shortcut. The Shortcut uses the screenshot you just took (ensure “Get Latest Screenshots” gets that one; on some versions you may need to use “Get Last Photo” with “Include Screenshots”).
- **From Shortcuts app:** Open the Shortcut and run it; it will use the most recent screenshot.

## Security

- Store your secret in the Shortcut (it’s only on your device). For stronger security, use a long random value for `PRICE_CHANGES_INGEST_SECRET` and never commit it.

## Troubleshooting

- **“No JSON object” / 500:** The OCR text might be empty or the LLM failed. Check Edge Function logs in Supabase Dashboard.
- **401 Unauthorized:** The `Authorization` or `x-api-key` value must match `PRICE_CHANGES_INGEST_SECRET`.
- **Empty rises/falls:** The source image may be unclear; try a cleaner screenshot or check that the text extracted in step 2 looks correct.
