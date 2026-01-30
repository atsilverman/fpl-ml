# Configuration Modal Setup Guide

## Overview

The configuration modal has been implemented to allow users to select a league and manager ID through a user-friendly interface. The system now displays actual league and manager names instead of IDs.

## What Was Implemented

### 1. Configuration Modal Component
- **Location**: `frontend/src/components/ConfigurationModal.jsx`
- **Features**:
  - Two-step selection process (League → Manager)
  - Displays league and manager names prominently
  - Shows IDs only when names are default placeholders
  - Responsive design with smooth animations

### 2. Configuration Context
- **Location**: `frontend/src/contexts/ConfigurationContext.jsx`
- **Features**:
  - Manages league and manager ID configuration
  - Persists to localStorage
  - Falls back to environment variables if no configuration exists

### 3. Updated Components
- **BentoCard**: Added "Configure" button below Settings button
- **HomePage**: Integrated modal and configuration handling
- **Hooks Updated**:
  - `useManagerData` - uses configured manager ID
  - `useTransfers` - uses configured manager ID
  - `useMiniLeagueStandings` - uses configured league ID

### 4. Backend Scripts Updated
- **`load_leagues.py`**: Now extracts manager names and fetches league names from FPL API
- **`populate_test_data.py`**: Updated to fetch league names
- **`update_league_manager_names.py`**: New script to backfill missing names

## Running the Name Update Script

To update existing leagues and managers with proper names from the FPL API:

### Prerequisites

1. Ensure you have the backend dependencies installed:
   ```bash
   cd backend
   source venv/bin/activate  # or your virtual environment
   pip install -r requirements.txt
   ```

2. Ensure your `.env` file has the correct Supabase credentials

### Update All Leagues and Managers

```bash
cd backend
source venv/bin/activate
python3 scripts/update_league_manager_names.py
```

This will:
- Fetch league names from the FPL API for all leagues in your database
- Fetch manager names from league standings
- Update the database with the correct names

### Update Specific Leagues

```bash
python3 scripts/update_league_manager_names.py --leagues 814685,123456,789012
```

### Update Only League Names

```bash
python3 scripts/update_league_manager_names.py --league-names-only
```

### Update Only Manager Names

```bash
python3 scripts/update_league_manager_names.py --manager-names-only
```

## How It Works

### League Names
The script fetches league names by:
1. Getting the first manager in each league
2. Calling the FPL API `/entry/{manager_id}/` endpoint
3. Extracting the league name from the manager's `leagues.classic` array
4. Updating the `mini_leagues` table

### Manager Names
The script fetches manager names by:
1. Calling the FPL API `/leagues-classic/{league_id}/standings/` endpoint
2. Extracting `entry_name` or `player_name` from each manager in the standings
3. Updating the `managers` table

## Frontend Usage

Once names are updated in the database:

1. Click the **Configure** button in the Settings bento card
2. **Step 1**: Select a league from the list (shows actual league names)
3. **Step 2**: Select a manager from that league (shows actual manager names)
4. Click **Save Configuration**

The configuration is saved to localStorage and persists across page reloads. The page will automatically reload to apply the new configuration.

## Database Schema

The following tables store the names:

- **`mini_leagues`**: `league_name` field
- **`managers`**: `manager_name` field

Both fields are already part of the schema and will be populated by the update script.

## Troubleshooting

### Names Not Showing
- Run the update script to fetch names from the FPL API
- Check that the database has the correct names in `mini_leagues.league_name` and `managers.manager_name`

### Script Errors
- Ensure you have network access (script calls FPL API)
- Check that your Supabase credentials are correct in `.env`
- Verify that leagues and managers exist in the database before running

### Modal Not Opening
- Check browser console for errors
- Ensure `ConfigurationProvider` wraps your app in `App.jsx`
- Verify that the Configure button has the `onConfigureClick` handler

## Next Steps

1. **Run the update script** to populate names for existing data:
   ```bash
   python3 backend/scripts/update_league_manager_names.py
   ```

2. **Test the modal** by clicking the Configure button in the Settings bento

3. **Verify names display** correctly in the modal

4. **For new leagues**, the `load_leagues.py` script will automatically fetch names when loading leagues
