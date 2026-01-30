# FPL Stats & Mini League Tracker

Full-stack web application for tracking Fantasy Premier League statistics and mini league standings.

## 📖 Documentation

**Start here:** [`PROJECT_DESIGN.md`](./PROJECT_DESIGN.md) - **Single source of truth** for project vision, architecture, and design decisions.

### Quick Links

- **[PROJECT_DESIGN.md](./PROJECT_DESIGN.md)** - Overall vision, architecture, data flow (START HERE)
- **[QUICK_START.md](./QUICK_START.md)** - Fast setup guide
- **[SUPABASE_DATABASE_SCHEMA_DESIGN.md](./SUPABASE_DATABASE_SCHEMA_DESIGN.md)** - Database structure
- **[FPL_API_COMPLETE_REFERENCE.md](./FPL_API_COMPLETE_REFERENCE.md)** - FPL API reference
- **[LEAGUE_STANDINGS_UI_REFERENCE.md](./LEAGUE_STANDINGS_UI_REFERENCE.md)** - Standings UI guide
- **[PLAYER_OWNED_LEADERBOARD_UI_REFERENCE.md](./PLAYER_OWNED_LEADERBOARD_UI_REFERENCE.md)** - Leaderboard UI guide

## Architecture

- **Backend**: Python async service running on Digital Ocean droplet
- **Database**: Supabase (PostgreSQL)
- **Frontend**: React + Vite, deployed on Vercel

## Project Structure

```
fpl-new/
├── backend/              # Python backend service
│   ├── src/
│   │   ├── main.py      # Entry point
│   │   ├── config.py    # Configuration
│   │   ├── database/    # Supabase client
│   │   ├── fpl_api/     # FPL API client
│   │   ├── refresh/     # Refresh orchestration
│   │   └── utils/        # Utilities
│   ├── supabase/         # Database migrations
│   └── systemd/          # Systemd service files
├── frontend/             # React frontend
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── contexts/   # React contexts
│   │   ├── hooks/      # Custom hooks
│   │   └── lib/        # Utilities
│   └── package.json
└── docs/                # Documentation
    ├── SUPABASE_DATABASE_SCHEMA_DESIGN.md
    ├── FPL_API_COMPLETE_REFERENCE.md
    └── SERVER_SIDE_SETUP.md
```

## Quick Start

### Backend Setup

1. Install dependencies:
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

2. Configure environment:
```bash
cp .env.example .env
# Edit .env with your credentials
```

3. Run migrations:
```bash
# Apply Supabase migrations from backend/supabase/migrations/
```

4. Run service:
```bash
python src/main.py
```

### Frontend Setup

1. Install dependencies:
```bash
cd frontend
npm install
```

2. Configure environment:
```bash
cp .env.example .env
# Edit .env with your Supabase credentials
```

3. Run development server:
```bash
npm run dev
```

## Features

- Real-time mini league standings
- Manager points tracking with provisional bonus
- Player statistics and DEFCON tracking
- Transfer history with net value analysis
- Live match tracking
- Player research tools
- Bento grid UI with consistent design system

## Deployment

See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for production deployment instructions.

## Core Principles

1. **Single Source of Truth** - No redundant data storage, compute from existing tables
2. **Data Integrity** - Track provisional vs final data explicitly
3. **Performance** - Use materialized views for expensive aggregations
4. **Real-Time Updates** - Live data sync during active gameweeks

See [`PROJECT_DESIGN.md`](./PROJECT_DESIGN.md) for complete design principles and architecture.
