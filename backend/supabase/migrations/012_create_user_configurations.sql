-- User Configurations Migration
-- Stores user-specific FPL manager and league configurations
-- Linked to Supabase Auth users via user_id (UUID)

CREATE TABLE IF NOT EXISTS user_configurations (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  manager_id BIGINT,
  league_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_configurations_user_id ON user_configurations(user_id);
CREATE INDEX IF NOT EXISTS idx_user_configurations_manager_id ON user_configurations(manager_id);
CREATE INDEX IF NOT EXISTS idx_user_configurations_league_id ON user_configurations(league_id);

-- Enable Row Level Security
ALTER TABLE user_configurations ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only read their own configuration
CREATE POLICY "Users can view own configuration"
  ON user_configurations
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own configuration
CREATE POLICY "Users can insert own configuration"
  ON user_configurations
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own configuration
CREATE POLICY "Users can update own configuration"
  ON user_configurations
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own configuration
CREATE POLICY "Users can delete own configuration"
  ON user_configurations
  FOR DELETE
  USING (auth.uid() = user_id);

COMMENT ON TABLE user_configurations IS 
'Stores user-specific FPL manager and league configurations.
- user_id: References auth.users(id) from Supabase Auth
- manager_id: FPL manager ID
- league_id: FPL mini league ID
- Each user can have one configuration (UNIQUE constraint on user_id)';
