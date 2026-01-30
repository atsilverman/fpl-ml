# Testing Guide: React Query Optimizations

## Quick Start Testing

### 1. Verify Installation & Setup

```bash
cd frontend
npm install
npm run dev
```

**Expected**: App starts on `http://localhost:3000` without errors

### 2. Verify Configuration

Check that environment variables are set:
- `VITE_MANAGER_ID=344182`
- `VITE_LEAGUE_ID=814685`

**Location**: `frontend/.env`

---

## Performance Testing

### Test 1: Initial Load Performance

1. **Open browser DevTools** (F12 or Cmd+Option+I)
2. **Go to Network tab**
3. **Clear network log** (trash icon)
4. **Hard refresh** (Cmd+Shift+R or Ctrl+Shift+R)
5. **Observe**:
   - Initial load should make Supabase queries
   - Check "Time" column - should be <3 seconds total
   - Note the number of Supabase requests

**Expected Results**:
- ✅ 3-5 Supabase queries on initial load
- ✅ Total load time: 2-3 seconds
- ✅ No errors in console

### Test 2: Caching Verification (Most Important!)

1. **Navigate to Home page** (wait for data to load)
2. **Navigate to Research page** (wait for data to load)
3. **Navigate back to Home page**
4. **Check Network tab**:
   - Should see **0 new Supabase queries** (data served from cache)
   - Page should load **instantly** (<0.5 seconds)

**Expected Results**:
- ✅ No Supabase queries on second visit (cached)
- ✅ Instant page load (<0.5s)
- ✅ Data still displays correctly

### Test 3: Query Deduplication

1. **Open React DevTools** (if installed)
2. **Go to Home page**
3. **Check Network tab**:
   - Multiple components use `useGameweekData` hook
   - Should see **only 1 query** for gameweek data (not multiple)

**Expected Results**:
- ✅ Only 1 query per unique data type
- ✅ Multiple components share same cached data

### Test 4: Background Refetching

1. **Navigate to Home page** (wait for data)
2. **Wait 30 seconds** (don't navigate away)
3. **Check Network tab**:
   - Should see automatic background refetch
   - Page should **not** show loading state
   - Data updates seamlessly

**Expected Results**:
- ✅ Automatic refetch every 30-60 seconds
- ✅ No loading flickers
- ✅ Data updates in background

### Test 5: Parallel Queries

1. **Open Network tab**
2. **Navigate to Home page**
3. **Check timing**:
   - `useManagerData` should run 2 queries in **parallel**
   - Both should start at same time (not sequential)

**Expected Results**:
- ✅ Manager history queries run simultaneously
- ✅ Faster than sequential (saves ~500ms-1s)

---

## Browser DevTools Verification

### Check React Query Cache

1. **Open browser console**
2. **Type**:
   ```javascript
   // Check if React Query is installed
   window.__REACT_QUERY_STATE__
   ```

3. **Or inspect React DevTools**:
   - Install React DevTools extension
   - Look for `QueryClientProvider` in component tree
   - Check query cache state

### Monitor Network Requests

**Key Metrics to Watch**:
- **Request Count**: Should decrease on subsequent loads
- **Cache Hits**: Should see "(from disk cache)" or "(from memory cache)"
- **Response Times**: Should be <100ms for cached requests

**Filter by**:
- Type: `xhr` or `fetch`
- Domain: `supabase.co`
- Status: `200`

---

## Component-Specific Testing

### HomePage
- ✅ Manager data loads (344182)
- ✅ Overall rank, points, team value display
- ✅ No loading flickers on navigation

### MiniLeaguePage
- ✅ League standings load (814685)
- ✅ All managers display
- ✅ Rank changes show correctly
- ✅ Refresh button works

### ResearchPage
- ✅ Player data loads quickly
- ✅ Search/filter works
- ✅ Data cached (fast on return visit)

### LivePage
- ✅ Fixtures load
- ✅ Live/finished matches display
- ✅ Auto-refreshes every 30s

---

## Performance Benchmarks

### Before Optimizations
- Initial Load: 3-5 seconds
- Subsequent Loads: 2-4 seconds
- Supabase Queries: 50-100 per session
- Egress: 16.19 GB/month

### After Optimizations (Target)
- Initial Load: 2-3 seconds
- Subsequent Loads: 0.5-1 second (cached)
- Supabase Queries: 10-20 per session (80% reduction)
- Egress: 3-4 GB/month (75% reduction)

---

## Troubleshooting

### Issue: Data not loading

**Check**:
1. Environment variables set correctly?
2. Supabase connection working?
3. Network tab shows errors?
4. Console shows React Query errors?

**Fix**:
```bash
# Verify .env file
cat frontend/.env

# Check Supabase connection
# Open browser console, check for errors
```

### Issue: No caching (still making queries)

**Check**:
1. React Query installed? `npm list @tanstack/react-query`
2. QueryClientProvider in `main.jsx`?
3. Hooks using `useQuery` instead of `useState`/`useEffect`?

**Fix**:
```bash
# Reinstall if needed
cd frontend
npm install @tanstack/react-query
```

### Issue: Slow loads

**Check**:
1. Network tab - are queries sequential or parallel?
2. Cache headers present?
3. Multiple duplicate queries?

**Expected**:
- Parallel queries in `useManagerData`
- Single query per data type (deduplication)
- Cached responses on subsequent loads

---

## Quick Verification Checklist

Run through this checklist to verify everything works:

- [ ] App starts without errors
- [ ] HomePage loads manager data (344182)
- [ ] MiniLeaguePage loads league standings (814685)
- [ ] ResearchPage loads player data
- [ ] LivePage loads fixtures
- [ ] Second visit to any page = instant load (cached)
- [ ] Network tab shows fewer queries on subsequent loads
- [ ] No console errors
- [ ] Background refetching works (wait 30s, see auto-refresh)

---

## Monitoring Supabase Egress

### Check Current Usage

1. **Go to Supabase Dashboard**
2. **Navigate to Settings → Usage**
3. **Check "Database Egress"**
4. **Compare**:
   - Before: ~16 GB/month
   - After: Should be ~3-4 GB/month (75% reduction)

### Track Daily Usage

Monitor daily egress to verify reduction:
- Day 1: Baseline
- Day 2-7: Should see gradual reduction
- Week 2+: Should stabilize at ~75% reduction

---

## Advanced Testing

### Test Cache Invalidation

1. **Navigate to MiniLeaguePage**
2. **Click "Refresh" button**
3. **Check Network tab**:
   - Should see new query
   - Data should update

### Test Stale-While-Revalidate

1. **Load a page** (data cached)
2. **Wait 30+ seconds** (data becomes stale)
3. **Navigate away and back**:
   - Should show cached data immediately
   - Then refetch in background
   - Update seamlessly

### Test Error Handling

1. **Disconnect internet**
2. **Navigate to page**:
   - Should show cached data if available
   - Should show error state if no cache

---

## Performance Comparison

### Before vs After

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Initial Load | 3-5s | 2-3s | 33% faster |
| Subsequent Loads | 2-4s | 0.5-1s | 75% faster |
| Queries per Session | 50-100 | 10-20 | 80% reduction |
| Cache Hit Rate | 0% | 70-80% | - |
| Egress per Month | 16 GB | 3-4 GB | 75% reduction |

---

## Next Steps After Testing

Once verified working:

1. ✅ **Monitor Supabase egress** for 1 week
2. ✅ **Track performance metrics** (load times, cache hits)
3. ✅ **Consider Phase 2**: API routes with edge caching (90-95% egress reduction)
4. ✅ **Document any issues** found during testing

---

## Quick Reference

### Key Files Modified
- `frontend/src/main.jsx` - QueryClientProvider setup
- `frontend/src/hooks/*.js` - All hooks converted to React Query
- `frontend/src/components/*.jsx` - Components use new hooks
- `frontend/.env` - Manager/League IDs configured

### Key Commands
```bash
# Start dev server
cd frontend && npm run dev

# Check React Query version
npm list @tanstack/react-query

# Verify environment variables
cat frontend/.env
```

### Key Browser Tools
- **Network Tab**: Monitor queries and caching
- **Console**: Check for errors
- **React DevTools**: Inspect React Query cache
- **Performance Tab**: Measure load times

---

## Success Criteria

✅ **All tests pass** if:
1. Initial load <3 seconds
2. Subsequent loads <1 second (cached)
3. 70-80% fewer Supabase queries
4. No console errors
5. All pages load correctly
6. Background refetching works

If all criteria met → **Optimizations successful!** 🎉
