/**
 * Google Analytics 4 (GA4) integration.
 * Set VITE_GA_MEASUREMENT_ID in .env (e.g. G-XXXXXXXXXX) to enable.
 */

const MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID

export function initAnalytics() {
  if (!MEASUREMENT_ID || typeof window === 'undefined') return
  window.dataLayer = window.dataLayer || []
  window.gtag = function gtag() {
    window.dataLayer.push(arguments)
  }
  window.gtag('js', new Date())
  window.gtag('config', MEASUREMENT_ID, {
    send_page_view: false, // we send page_view on route change for SPA
  })
  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`
  document.head.appendChild(script)
}

export function trackPageView(path, title) {
  if (!MEASUREMENT_ID || typeof window === 'undefined' || !window.gtag) return
  window.gtag('event', 'page_view', {
    page_path: path,
    page_title: title ?? document.title,
  })
}
