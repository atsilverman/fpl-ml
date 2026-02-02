-- Table for price change predictions (risers/fallers) from screenshot OCR pipeline.
-- One row per capture; UI shows latest row. Edge Function inserts via service role.

CREATE TABLE IF NOT EXISTS price_change_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rises JSONB NOT NULL DEFAULT '[]',
  falls JSONB NOT NULL DEFAULT '[]',
  raw_text TEXT
);

CREATE INDEX IF NOT EXISTS idx_price_change_predictions_captured_at
  ON price_change_predictions(captured_at DESC);

COMMENT ON TABLE price_change_predictions IS
  'FPL price change predictions from screenshot OCR. rises/falls are arrays of { player_name, team_short_name }. UI shows latest row.';

ALTER TABLE price_change_predictions ENABLE ROW LEVEL SECURITY;

-- Allow read for anon and authenticated (frontend). Inserts done by Edge Function with service role.
CREATE POLICY "Allow read price_change_predictions"
  ON price_change_predictions FOR SELECT
  TO anon, authenticated
  USING (true);
