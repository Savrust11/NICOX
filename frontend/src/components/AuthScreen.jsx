import { useState } from 'react'
import { Cat, LogIn, UserPlus } from 'lucide-react'
import { useAuth } from '../lib/AuthContext'
import './AuthScreen.css'

function translateAuthError(msg) {
  if (!msg) return '処理に失敗しました'
  const s = String(msg)
  const rate = s.match(/For security purposes, you can only request this after (\d+) seconds?/i)
  if (rate) return `セキュリティ保護のため、${rate[1]}秒後に再度お試しください。`
  const overEmail = s.match(/email rate limit exceeded/i)
  if (overEmail) return 'メール送信回数の上限を超えました。しばらく時間をおいてからお試しください。'
  if (/Invalid login credentials/i.test(s)) return 'メールアドレスまたはパスワードが正しくありません。'
  if (/Email not confirmed/i.test(s)) return 'メールアドレスが未確認です。受信メールのリンクから承認を完了してください。'
  if (/User already registered/i.test(s)) return 'このメールアドレスは既に登録されています。'
  if (/Password should be at least/i.test(s)) return 'パスワードが短すぎます。'
  if (/Unable to validate email address/i.test(s)) return 'メールアドレスの形式が正しくありません。'
  if (/Signup (is )?disabled/i.test(s)) return '新規登録は現在無効化されています。'
  return s
}

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
      setError(translateAuthError(err.message))
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
