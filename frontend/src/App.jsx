import { useState } from 'react'
import { Cat, LogIn, LogOut, Map as MapIcon, PencilLine, Shield } from 'lucide-react'
import { Toaster, toast } from 'sonner'
import { useAuth } from './lib/AuthContext'
import ReportForm from './components/ReportForm'
import MapView from './components/MapView'
import PublicStats from './components/PublicStats'
import AuthScreen from './components/AuthScreen'
import AdminPanel from './components/AdminPanel'
import './App.css'

export default function App() {
  const { user, session, loading, signOut } = useAuth()
  const [tab, setTab] = useState('home')
  const [showAuth, setShowAuth] = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)

  async function handleConfirmLogout() {
    setShowLogoutConfirm(false)
    await signOut()
    setTab('home')
    toast.success('ログアウトしました')
  }

  const role = user?.role
  const isApproved = user?.approval_status === 'approved' || role === 'admin'
  const isAdmin = role === 'admin'

  if (loading) {
    return (
      <div className="loading-screen">
        <Cat size={36} strokeWidth={1.8} color="#e67e22" />
        <p>読み込み中...</p>
      </div>
    )
  }

  if (showAuth) {
    return <AuthScreen onClose={() => setShowAuth(false)} />
  }

  // Tabs available to this user
  const tabs = []
  tabs.push({ id: 'home', label: 'ホーム', icon: <Cat size={14} strokeWidth={2.2} /> })
  tabs.push({ id: 'report', label: '通報する', icon: <PencilLine size={14} strokeWidth={2.2} /> })
  if (isApproved) {
    tabs.push({ id: 'map', label: '地図を見る', icon: <MapIcon size={14} strokeWidth={2.2} /> })
  }
  if (isAdmin) {
    tabs.push({ id: 'admin', label: '管理', icon: <Shield size={14} strokeWidth={2.2} /> })
  }

  // Make sure currently active tab is still valid
  const activeTab = tabs.find((t) => t.id === tab) ? tab : 'home'

  function renderTab() {
    if (activeTab === 'report') return <ReportForm onSuccess={() => setTab(isApproved ? 'map' : 'home')} />
    if (activeTab === 'map' && isApproved) return <MapView />
    if (activeTab === 'admin' && isAdmin) return <AdminPanel />
    return <PublicStats />
  }

  return (
    <div className="app">
      <header className="header">
        <span className="header-title">
          <Cat size={20} strokeWidth={2} color="#e67e22" />
          <span>NICOX 野良猫マップ</span>
        </span>
        <nav className="tabs">
          {tabs.map((t) => (
            <button key={t.id}
              className={activeTab === t.id ? 'tab active' : 'tab'}
              onClick={() => setTab(t.id)}>
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
          {session ? (
            <button className="tab tab-account" onClick={() => setShowLogoutConfirm(true)} title={user?.name || ''}>
              <LogOut size={14} strokeWidth={2.2} />
              <span>ログアウト</span>
            </button>
          ) : (
            <button className="tab tab-signin" onClick={() => setShowAuth(true)}>
              <LogIn size={14} strokeWidth={2.2} />
              <span>ログイン</span>
            </button>
          )}
        </nav>
      </header>

      {/* Pending-approval banner for approved-not-yet users */}
      {session && user && !isApproved && (
        <div className="approval-banner">
          現在「承認待ち」のため、地図機能はまだご利用いただけません。
          管理者の承認をお待ちください。
        </div>
      )}

      <main className="main">
        {renderTab()}
      </main>

      {showLogoutConfirm && (
        <div className="logout-backdrop" onClick={() => setShowLogoutConfirm(false)}>
          <div className="logout-modal" onClick={(e) => e.stopPropagation()}>
            <div className="logout-icon"><LogOut size={28} strokeWidth={2} /></div>
            <h3>ログアウトしますか？</h3>
            <p>再度ご利用の際は、もう一度ログインが必要です。</p>
            <div className="logout-actions">
              <button className="logout-cancel" onClick={() => setShowLogoutConfirm(false)}>キャンセル</button>
              <button className="logout-confirm" onClick={handleConfirmLogout}>ログアウト</button>
            </div>
          </div>
        </div>
      )}

      <Toaster position="top-right" richColors closeButton />
    </div>
  )
}
