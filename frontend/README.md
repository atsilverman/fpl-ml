# FPL Frontend

React + Vite frontend for FPL Stats & Mini League Tracker.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file:
```bash
cp .env.example .env
# Edit .env with your Supabase credentials
```

3. Run development server:
```bash
npm run dev
```

4. Build for production:
```bash
npm run build
```

## Environment Variables

- `VITE_SUPABASE_URL` - Your Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Your Supabase anon key
- `VITE_MANAGER_ID` - Your FPL manager ID (optional)
- `VITE_LEAGUE_ID` - Your mini league ID (optional)

## Performance Optimizations

This app uses **React Query** for optimized data fetching:
- ✅ Automatic caching (30-60s)
- ✅ Query deduplication
- ✅ Background refetching
- ✅ 70-80% reduction in Supabase queries

**See [TESTING_GUIDE.md](./TESTING_GUIDE.md) for detailed testing instructions.**

## Deployment to Vercel

1. Push code to GitHub
2. Import project in Vercel
3. Add environment variables in Vercel dashboard
4. Deploy

Vercel will automatically detect Vite and build accordingly.
