import { useState, useEffect } from 'react'

const fallbackAvatarUrl = (user) =>
  `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.user_metadata?.full_name || user?.email || 'User')}&background=random`

// One fetch per Google avatar URL per session so multiple components don't each hit the CDN (avoids 429)
const avatarCache = new Map() // googleUrl -> Promise<string | null> (object URL or null on failure)

function fetchAvatarAsObjectUrl(googleUrl) {
  return fetch(googleUrl, { referrerPolicy: 'no-referrer', credentials: 'omit' })
    .then((res) => {
      if (!res.ok) throw new Error(res.status.toString())
      return res.blob()
    })
    .then((blob) => URL.createObjectURL(blob))
    .catch(() => null)
}

function getCachedAvatarUrl(googleUrl, retryOnce = true) {
  const cacheKey = retryOnce ? `${googleUrl}:retry` : googleUrl
  if (avatarCache.has(cacheKey)) return avatarCache.get(cacheKey)

  const promise = fetchAvatarAsObjectUrl(googleUrl).then((objectUrl) => {
    if (objectUrl) return objectUrl
    if (retryOnce) {
      return new Promise((resolve) => {
        window.setTimeout(() => {
          fetchAvatarAsObjectUrl(googleUrl).then(resolve)
        }, 2500)
      })
    }
    return null
  })
  avatarCache.set(cacheKey, promise)
  return promise
}

export default function UserAvatar({ user, className, alt = '' }) {
  const googleUrl = user?.user_metadata?.avatar_url || null
  const [resolvedUrl, setResolvedUrl] = useState(null) // 'loading' | objectURL string | 'fallback'
  const [useFallback, setUseFallback] = useState(false)

  useEffect(() => {
    if (!googleUrl) {
      setResolvedUrl('fallback')
      return
    }
    let cancelled = false
    setResolvedUrl(null)
    getCachedAvatarUrl(googleUrl)
      .then((objectUrl) => {
        if (cancelled) return
        setResolvedUrl(objectUrl || 'fallback')
      })
    return () => { cancelled = true }
  }, [googleUrl])

  const src =
    useFallback || resolvedUrl === 'fallback' || !resolvedUrl
      ? fallbackAvatarUrl(user)
      : resolvedUrl

  return (
    <img
      src={src}
      alt={alt || user?.user_metadata?.full_name || user?.email || ''}
      className={className}
      onError={() => setUseFallback(true)}
    />
  )
}
