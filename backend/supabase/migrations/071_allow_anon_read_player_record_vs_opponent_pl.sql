-- Allow frontend (anon) to read player_record_vs_opponent_pl for "vs G / vs A / W-D-L" in player detail modal.
ALTER TABLE player_record_vs_opponent_pl ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon select player_record_vs_opponent_pl"
  ON player_record_vs_opponent_pl
  FOR SELECT TO anon
  USING (true);
