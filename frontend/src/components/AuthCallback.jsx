import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function AuthCallback() {
  const navigate = useNavigate()
  const handled = useRef(false)
  const timeoutRef = useRef(null)
  const subscriptionRef = useRef(null)

  useEffect(() => {
    const redirectHome = () => {
      if (handled.current) return
      handled.current = true
      navigate('/', { replace: true })
    }

    const run = async () => {
      const { data, error } = await supabase.auth.getSession()
      if (error) {
        console.error('Error getting session:', error)
        redirectHome()
        return
      }
      if (data.session) {
        redirectHome()
        return
      }

      // Session may still be in URL hash; Supabase parses it async. Wait for auth change.
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session) redirectHome()
      })
      subscriptionRef.current = subscription

      timeoutRef.current = window.setTimeout(() => {
        redirectHome()
      }, 4000)
    }

    run()

    return () => {
      if (subscriptionRef.current) subscriptionRef.current.unsubscribe()
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [navigate])

  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      height: '100vh',
      flexDirection: 'column',
      gap: '16px'
    }}>
      <div>Completing sign in...</div>
      <div style={{ fontSize: '14px', color: '#666' }}>Please wait while we redirect you.</div>
    </div>
  )
}
