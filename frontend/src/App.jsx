import { useState } from 'react'
import { Map as MapIcon, PencilLine, Cat } from 'lucide-react'
import ReportForm from './components/ReportForm'
import MapView from './components/MapView'
import './App.css'

export default function App() {
  const [tab, setTab] = useState('map')

  return (
    <div className="app">
      <header className="header">
        <span className="header-title">
          <Cat size={20} strokeWidth={2} />
          <span>NICOX 野良猫マップ</span>
        </span>
        <nav className="tabs">
          <button
            className={tab === 'map' ? 'tab active' : 'tab'}
            onClick={() => setTab('map')}
          >
            <MapIcon size={14} strokeWidth={2.2} />
            <span>地図を見る</span>
          </button>
          <button
            className={tab === 'report' ? 'tab active' : 'tab'}
            onClick={() => setTab('report')}
          >
            <PencilLine size={14} strokeWidth={2.2} />
            <span>通報する</span>
          </button>
        </nav>
      </header>

      <main className="main">
        {tab === 'map' ? <MapView /> : <ReportForm onSuccess={() => setTab('map')} />}
      </main>
    </div>
  )
}
