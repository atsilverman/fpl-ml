import { useAuth } from '../contexts/AuthContext'
import UserAvatar from './UserAvatar'
import './ConfigurationModal.css'

export default function AccountModal({ isOpen, onClose }) {
  const { user, loading: authLoading, signInWithGoogle, signOut } = useAuth()

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Account</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-body">
          {authLoading ? (
            <div className="modal-auth-loading">Loading...</div>
          ) : user ? (
            <div className="modal-auth-signed-in">
              <UserAvatar user={user} className="modal-auth-avatar" />
              <span className="modal-auth-name">
                {user.user_metadata?.full_name || user.email}
              </span>
              <button
                type="button"
                className="modal-auth-signout"
                onClick={signOut}
              >
                Sign out
              </button>
            </div>
          ) : (
            <div className="modal-auth-unsigned">
              <p className="modal-auth-hint">Sign in with Google to save your configuration across devices</p>
              <button
                type="button"
                className="modal-auth-google"
                onClick={signInWithGoogle}
              >
                <svg className="modal-auth-google-icon" viewBox="0 0 24 24" width="20" height="20">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Sign in with Google
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
