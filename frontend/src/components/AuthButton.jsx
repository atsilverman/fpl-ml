import { useAuth } from '../contexts/AuthContext'
import './AuthButton.css'

export default function AuthButton() {
  const { user, loading, signOut } = useAuth()

  // Don't show anything in the header until signed in; sign-in is via Account (player search) modal
  if (loading || !user) {
    return null
  }

  return (
    <div className="auth-button-container">
      <div className="auth-user-info">
        <img
          src={user.user_metadata?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.user_metadata?.full_name || user.email)}&background=random`}
          alt={user.user_metadata?.full_name || user.email}
          className="auth-avatar"
        />
        <span className="auth-user-name">
          {user.user_metadata?.full_name || user.email}
        </span>
      </div>
      <button className="auth-button auth-button-signout" onClick={signOut}>
        Sign Out
      </button>
    </div>
  )
}
