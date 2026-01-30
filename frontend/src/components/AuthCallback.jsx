import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function AuthCallback() {
  const navigate = useNavigate()

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        const { data, error } = await supabase.auth.getSession()
        
        if (error) {
          console.error('Error getting session:', error)
          navigate('/')
          return
        }

        if (data.session) {
          // Successfully authenticated, redirect to home
          navigate('/')
        } else {
          // No session, redirect to home
          navigate('/')
        }
      } catch (error) {
        console.error('Error handling auth callback:', error)
        navigate('/')
      }
    }

    handleAuthCallback()
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
