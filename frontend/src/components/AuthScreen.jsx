import { useState } from 'react'
import { Cat, LogIn, UserPlus } from 'lucide-react'
import { useAuth } from '../lib/AuthContext'
import './AuthScreen.css'

export default function AuthScreen({ onClose }) {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState('login') // 'login' | 'register'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [organization, setOrganization] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setInfo('')
    try {
      if (mode === 'login') {
        await signIn(email, password)
        if (onClose) onClose()
      } else {
        await signUp(email, password, { name, organization })
        setInfo('登録メールを送信しました。メール内のリンクをクリックして承認を完了してください。')
      }
    } catch (err) {
      setError(err.message || '処理に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-header">
          <Cat size={36} strokeWidth={1.8} color="#e67e22" />
          <h2>NICOX</h2>
          <p>{mode === 'login' ? 'ログイン' : '新規会員登録'}</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {mode === 'register' && (
            <>
              <div className="auth-field">
                <label>お名前</label>
                <input type="text" value={name} required
                  onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="auth-field">
                <label>所属団体（任意）</label>
                <input type="text" value={organization}
                  onChange={(e) => setOrganization(e.target.value)} />
              </div>
            </>
          )}

          <div className="auth-field">
            <label>メールアドレス</label>
            <input type="email" value={email} required autoComplete="email"
              onChange={(e) => setEmail(e.target.value)} />
          </div>

          <div className="auth-field">
            <label>パスワード（8文字以上）</label>
            <input type="password" value={password} minLength={8} required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              onChange={(e) => setPassword(e.target.value)} />
          </div>

          {error && <p className="auth-error">{error}</p>}
          {info && <p className="auth-info">{info}</p>}

          <button type="submit" className="auth-submit" disabled={busy}>
            {mode === 'login' ? <LogIn size={18} /> : <UserPlus size={18} />}
            {busy ? '処理中...' : mode === 'login' ? 'ログイン' : '登録する'}
          </button>
        </form>

        <button type="button" className="auth-switch"
          onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setInfo('') }}>
          {mode === 'login' ? 'まだアカウントがない方はこちら' : 'すでにアカウントをお持ちの方はこちら'}
        </button>

        {onClose && (
          <button type="button" className="auth-cancel" onClick={onClose}>
            キャンセル（一般公開モードで閲覧）
          </button>
        )}

        {mode === 'register' && (
          <p className="auth-note">
            ※ 登録後、管理者の承認をもって地図機能をご利用いただけます。
            承認まで時間がかかる場合があります。
          </p>
        )}
      </div>
    </div>
  )
}
