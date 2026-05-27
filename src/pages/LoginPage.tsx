import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { isDisposableEmail } from '../lib/crypto'

const Logo = () => (
  <svg viewBox="0 0 64 64" width="64" style={{ display:'block', margin:'0 auto 10px' }}>
    <polygon points="32,2 62,32 32,62 2,32" fill="#F9A825"/>
    <polygon points="32,10 54,32 32,54 10,32" fill="#1565C0"/>
    <path d="M22 20 Q22 14 30 13 L36 13 Q44 13 44 20 Q44 27 36 30 L28 33 Q20 36 20 43 Q20 50 28 52 L36 52 Q44 52 44 45"
          fill="none" stroke="#C62828" strokeWidth="6" strokeLinecap="round"/>
    <path d="M22 20 Q22 14 30 13 L36 13 Q44 13 44 20 Q44 27 36 30 L28 33 Q20 36 20 43 Q20 50 28 52 L36 52 Q44 52 44 45"
          fill="none" stroke="#FFD600" strokeWidth="3.5" strokeLinecap="round"/>
  </svg>
)

type View = 'login' | 'delete-request' | 'delete-sent'

export function LoginPage() {
  const [view, setView]         = useState<View>('login')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [delEmail, setDelEmail] = useState('')
  const [delErr, setDelErr]     = useState('')

  const { login, requestAccountDeletion, loading, error,
          isAuthenticated, cryptoReady, clearError } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    if (isAuthenticated && cryptoReady) navigate('/', { replace: true })
  }, [isAuthenticated, cryptoReady, navigate])

  useEffect(() => { clearError() }, [view])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    await login(email, password)
  }

  const handleDeleteRequest = async (e: React.FormEvent) => {
    e.preventDefault(); setDelErr('')
    if (isDisposableEmail(delEmail)) { setDelErr('Email non valida.'); return }
    await requestAccountDeletion(delEmail)
    if (!useAuthStore.getState().error) setView('delete-sent')
    else setDelErr(useAuthStore.getState().error ?? '')
  }

  if (view === 'delete-sent') return (
    <div className="auth-page"><div className="auth-container fade-in">
      <div style={{ textAlign:'center', marginBottom:16 }}>
        <span style={{ fontSize:'3rem', display:'block', marginBottom:10 }}>📧</span>
        <h2>Controlla la tua email</h2>
        <p style={{ marginTop:8, fontSize:'0.88rem' }}>
          Link di eliminazione inviato a<br/>
          <strong style={{ color:'var(--red)' }}>{delEmail}</strong>
        </p>
      </div>
      <div className="alert alert-error" style={{ fontSize:'0.83rem' }}>
        ⚠️ Il link è valido per 60 minuti. Cliccandolo eliminerai <strong>definitivamente</strong> account e dati.
      </div>
      <button className="btn btn-ghost btn-full" onClick={() => setView('login')}>← Torna al login</button>
    </div><style>{AUTH_CSS}</style></div>
  )

  if (view === 'delete-request') return (
    <div className="auth-page"><div className="auth-container fade-in">
      <div style={{ textAlign:'center', marginBottom:16 }}>
        <span style={{ fontSize:'3rem', display:'block', marginBottom:10 }}>🗑️</span>
        <h2>Elimina account</h2>
        <p style={{ marginTop:6, fontSize:'0.86rem' }}>Funziona anche senza password. Verifica via email.</p>
      </div>
      <div className="alert alert-error" style={{ fontSize:'0.82rem' }}>
        ⚠️ Eliminazione <strong>irreversibile</strong>: articoli, categorie, account.
      </div>
      {delErr && <div className="alert alert-error"><span>⚠</span> {delErr}</div>}
      <form onSubmit={handleDeleteRequest} style={{ display:'flex', flexDirection:'column', gap:14 }}>
        <div className="field">
          <label>La tua email</label>
          <input type="email" className="input" value={delEmail}
            onChange={e => setDelEmail(e.target.value)} required autoFocus/>
        </div>
        <button type="submit" className="btn btn-danger btn-full btn-lg" disabled={loading}>
          {loading ? <span className="spinner"/> : '📧 Invia link di eliminazione'}
        </button>
      </form>
      <button className="btn btn-ghost btn-full" onClick={() => { setView('login'); setDelErr('') }}>← Annulla</button>
    </div><style>{AUTH_CSS}</style></div>
  )

  const displayError    = error && !error.startsWith('📧') ? error : null
  const emailConfirmMsg = error?.startsWith('📧') ? error.replace('📧 ', '') : null

  return (
    <div className="auth-page"><div className="auth-container fade-in">
      <div className="auth-brand">
        <Logo/>
        <h1 style={{ fontSize:'2rem' }}>StockSafe</h1>
        <p>Il tuo magazzino sicuro</p>
        <div className="badge badge-accent" style={{ margin:'8px auto 0', display:'inline-flex' }}>
          🔑 Password unica
        </div>
      </div>

      {displayError    && <div className="alert alert-error"><span>⚠</span> {displayError}</div>}
      {emailConfirmMsg && <div className="alert alert-success"><span>📧</span> {emailConfirmMsg}</div>}

      <form onSubmit={handleLogin} autoComplete="on" id="login-form"
        style={{ display:'flex', flexDirection:'column', gap:13 }}>
        <div className="field">
          <label>Email</label>
          <input type="email" className="input" value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete="email" name="username" id="login-email" required placeholder="mario@esempio.it"/>
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" className="input" value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password" name="password" id="login-password" required/>
          <small style={{ color:'var(--text-muted)', fontSize:'0.73rem' }}>
            Questa password cifra anche i tuoi dati — cambiarla invalida i dati precedenti.
          </small>
        </div>
        <button type="submit" className="btn btn-primary btn-full btn-lg"
          style={{ marginTop:4 }} disabled={loading}>
          {loading ? <span className="spinner"/> : 'Accedi'}
        </button>
      </form>

      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
        <Link to="/register" className="btn btn-ghost btn-full">Crea account</Link>
        <Link to="/reset-password" className="btn btn-ghost btn-full btn-sm"
          style={{ color:'var(--red)', borderColor:'rgba(239,68,68,.25)', fontSize:'0.78rem' }}>
          ⚠️ Reset password (attenzione: invalida i dati cifrati)
        </Link>
      </div>

      <div style={{ borderTop:'1px solid var(--border)', paddingTop:14, marginTop:4 }}>
        <button className="btn btn-ghost btn-full btn-sm"
          style={{ color:'var(--red)', borderColor:'rgba(239,68,68,.25)', fontSize:'0.78rem' }}
          onClick={() => setView('delete-request')}>
          🗑 Elimina il mio account
        </button>
      </div>
    </div><style>{AUTH_CSS}</style></div>
  )
}

const AUTH_CSS = `
.auth-page {
  min-height: 100svh;
  min-height: 100vh;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 48px 16px 32px;
  background: radial-gradient(ellipse 70% 35% at 50% 0%, var(--accent-glow) 0%, transparent 65%), var(--bg-base);
}
.auth-container {
  width: 100%;
  max-width: 400px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.auth-brand { text-align: center; margin-bottom: 6px; }
.auth-brand h1 { font-size: 2rem; }
.auth-brand p  { font-size: 0.86rem; }
`
