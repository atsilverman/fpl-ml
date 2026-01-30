# Quick Start Guide

## First Time Setup

### 1. Install Dependencies
```bash
cd frontend
npm install
```

### 2. Verify Environment Variables
Check `frontend/.env` has:
```
VITE_MANAGER_ID=344182
VITE_LEAGUE_ID=814685
```

### 3. Start Dev Server
```bash
npm run dev
```

App should open at `http://localhost:3000`

---

## Quick Verification (30 seconds)

1. **Open browser DevTools** (F12)
2. **Go to Network tab**
3. **Navigate to Home page** → Wait for data
4. **Navigate to Research page** → Wait for data
5. **Navigate back to Home page** → Should load **instantly** (cached)

✅ **Success if**: Second visit to Home page = instant load with 0 new Supabase queries

---

## Full Testing

See [TESTING_GUIDE.md](./TESTING_GUIDE.md) for comprehensive testing instructions.

---

## Troubleshooting

**App won't start?**
```bash
npm install
npm run dev
```

**Data not loading?**
- Check `.env` file has correct IDs
- Check browser console for errors
- Verify Supabase connection

**Still slow?**
- Check Network tab - should see cached requests
- Verify React Query is installed: `npm list @tanstack/react-query`
