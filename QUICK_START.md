# Quick Start Guide

## Prerequisites

- Python 3.11+
- Node.js 18+
- Supabase project (already configured)

## 1. Get Your Anon Key

1. Visit: https://supabase.com/dashboard/project/rjkgwyngnqgzqudqqzqi/settings/api
2. Copy the **anon** or **public** key (not the service_role key)

## 2. Run Database Migrations

1. Go to Supabase SQL Editor: https://supabase.com/dashboard/project/rjkgwyngnqgzqudqqzqi/sql/new
2. Run each migration file in order:
   - `backend/supabase/migrations/001_create_tables.sql`
   - `backend/supabase/migrations/002_create_materialized_views.sql`
   - `backend/supabase/migrations/003_create_refresh_functions.sql`
   - `backend/supabase/migrations/004_create_player_owned_leaderboard_view.sql`

## 3. Backend Setup

```bash
cd backend

# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Update .env with your anon key
# Edit backend/.env and set SUPABASE_KEY to your anon key

# Test connection
python3 -c "from src.config import Config; from src.database.supabase_client import SupabaseClient; c = Config(); client = SupabaseClient(c); print('✅ Backend connected!')"
```

## 3.5. Populate Test Data (Optional but Recommended)

Populate database with initial data for testing:

```bash
cd backend
source venv/bin/activate

# Option 1: Populate all managers from a league (RECOMMENDED)
python3 scripts/populate_test_data.py --league 814685

# Option 2: Populate specific managers
python3 scripts/populate_test_data.py --managers 12345,67890

# Option 3: Populate core data only (no managers)
python3 scripts/populate_test_data.py --skip-managers

# Refresh materialized views after population
# Run in Supabase SQL Editor:
# SELECT refresh_all_materialized_views();
```

**What gets populated:**
- ✅ All 20 teams (with names and abbreviations for badges)
- ✅ All ~800 players
- ✅ All 38 gameweeks  
- ✅ All 380 fixtures
- ✅ All managers from specified league (if using `--league`)
- ✅ Manager picks & transfers for current gameweek
- ✅ Player whitelist (if using `--league`)

**Note:** This populates data for testing. Egress (data transfer out) is minimal during development. See `EGRESS_AND_TESTING.md` for details.

## 4. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Create .env file
cat > .env << EOF
VITE_SUPABASE_URL=https://rjkgwyngnqgzqudqqzqi.supabase.co
VITE_SUPABASE_ANON_KEY=<paste_your_anon_key_here>
VITE_MANAGER_ID=<your_fpl_manager_id>
VITE_LEAGUE_ID=<your_mini_league_id>
EOF

# Start development server
npm run dev
```

## 5. Start Backend Service

```bash
cd backend
source venv/bin/activate
python3 src/main.py
```

The backend will start syncing data from the FPL API to Supabase.

## 6. Access Frontend

Open http://localhost:3000 in your browser.

## Configuration

### Finding Your Manager ID
1. Go to https://fantasy.premierleague.com
2. View your team
3. The URL will contain your manager ID: `https://fantasy.premierleague.com/entry/123456/`

### Finding Your League ID
1. Go to your mini league page
2. The URL will contain the league ID: `https://fantasy.premierleague.com/leagues/123456/standings/c`

## Next Steps

- Monitor backend logs to ensure data is syncing
- Check Supabase dashboard to verify data is being written
- Customize frontend components as needed
- Deploy to production (see DEPLOYMENT.md)
