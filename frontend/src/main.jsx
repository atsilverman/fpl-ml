import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App.jsx'
import { initAnalytics } from './analytics'
import './index.css'

initAnalytics()

// Create a query client with optimized defaults for FPL data
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000, // Data is fresh for 30 seconds (shared data cache)
      gcTime: 60000, // Keep in cache for 1 minute (formerly cacheTime)
      refetchOnWindowFocus: false, // Don't refetch on window focus (reduce queries)
      refetchOnReconnect: true, // Refetch when connection restored
      refetchIntervalInBackground: true, // Keep polling when tab is in background
      retry: 1, // Only retry once on failure
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
)
