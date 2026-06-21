import { useEffect, useRef, useState, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { AlertTriangle, Baby, CircleAlert, CircleCheck, RefreshCw, X } from 'lucide-react'
import { api } from '../lib/api'
import { getInitialView, saveView } from '../lib/viewState'
import './MapView.css'

const LOCATE_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2v4"/><path d="M12 18v4"/><path d="M2 12h4"/><path d="M18 12h4"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>'

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'

function hotspotColor(h) {
  if (h.has_kitten) return '#e74c3c'
  if (!h.has_ear_cut_visible) return '#f39c12'
  return '#27ae60'
}

function HotspotLabel({ hotspot, color }) {
  if (hotspot.has_kitten) {
    return (
      <span className="label-with-icon" style={{ color }}>
        <AlertTriangle size={14} strokeWidth={2.5} /> 要対応（子猫）
      </span>
    )
  }
  if (!hotspot.has_ear_cut_visible) {
    return (
      <span className="label-with-icon" style={{ color }}>
        <CircleAlert size={14} strokeWidth={2.5} /> 未去勢
      </span>
    )
  }
  return (
    <span className="label-with-icon" style={{ color }}>
      <CircleCheck size={14} strokeWidth={2.5} /> 管理済
    </span>
  )
}

function hotspotIcon(h) {
  const size = Math.min(32 + (h.report_count || 1) * 6, 60)
  const color = hotspotColor(h)
  return L.divIcon({
    className: 'hotspot-marker',
    html: `<div class="hotspot-pin" style="background:${color};width:${size}px;height:${size}px">${h.cat_count_estimate ?? h.report_count}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

const reportIcon = L.divIcon({
  className: 'report-marker',
  html: '<div class="report-dot"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
})

const userLocationIcon = L.divIcon({
  className: 'user-location-marker',
  html: '<div class="user-location-pulse"></div><div class="user-location-dot"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
})

function escapeHtml(str) {
  return (str || '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
}

const PROBLEM_LABELS = {
  waste_damage: '糞尿被害',
  noise_damage: '鳴き声被害',
  cats_increasing: '猫が増えている',
  hoarding_site: '多頭飼育現場がある',
  feeding_issue: '餌やりトラブル',
  // legacy
  waste: '糞尿', kittens: '子猫', noise: '鳴き声', unfixed: '未手術猫', feeding: '餌やり問題',
}
const REQUEST_LABELS = {
  reduce_damage: '被害を減らしたい',
  reduce_cats: '猫を減らしたい',
  want_surgery: '手術をしたい',
  consult: '相談したい',
  volunteer: '活動に協力したい',
  // legacy
  immediate: 'すぐ対応してほしい',
}
const RANGE_LABELS = { '1-3': '1〜3匹', '4-10': '4〜10匹', '10+': '10匹以上', 'unknown': '不明' }
const KITTEN_LABELS = { present: 'いる', absent: 'いない', unknown: '不明' }
const EARCUT_LABELS = { all: '全てあり', some: '一部あり', none: 'なし', unknown: '不明' }
const INVOLVEMENT_LABELS = { info_only: '情報提供のみ', capture_help: '捕獲協力可能', ongoing_involvement: '継続的に関与可能' }
const FUNDING_LABELS = { none: '負担不可', partial: '一部可能', full: '全額可能' }

export default function MapView() {
  const mapContainer = useRef(null)
  const map = useRef(null)
  const layersRef = useRef([])
  const userMarker = useRef(null)
  const accuracyCircle = useRef(null)
  const userRequestedLocate = useRef(false)

  const [selected, setSelected] = useState(null)
  const [hotspotReports, setHotspotReports] = useState([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [loading, setLoading] = useState(true)

  const clearLayers = () => {
    layersRef.current.forEach((l) => l.remove())
    layersRef.current = []
  }

  const onHotspotClick = useCallback(async (h) => {
    setSelected(h)
    setHotspotReports([])
    setDetailLoading(true)
    try {
      const detail = await api.getHotspot(h.id)
      setHotspotReports(detail.reports || [])
    } catch (err) {
      console.error('Failed to load hotspot detail:', err)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const plotData = useCallback(async () => {
    if (!map.current) return
    setLoading(true)
    try {
      const [{ reports }, { hotspots: hs }] = await Promise.all([
        api.getReports({ limit: 500 }),
        api.getHotspots(),
      ])
      clearLayers()

      reports.forEach((r) => {
        const firstImage = Array.isArray(r.media_urls) && r.media_urls[0]
        const countLabel = r.cat_count_range
          ? RANGE_LABELS[r.cat_count_range] || `${r.cat_count} 匹`
          : `${r.cat_count ?? '?'} 匹`
        const problemTags = (r.problem_types || [])
          .map((p) => `<span class="tag">${PROBLEM_LABELS[p] || p}</span>`)
          .join('')
        const requestTags = (r.requests || [])
          .map((p) => `<span class="tag yellow">${REQUEST_LABELS[p] || p}</span>`)
          .join('')
        const popupHtml = `<div class="popup">
          ${firstImage ? `<img class="popup-img" src="${firstImage}" alt="" />` : ''}
          <strong>${countLabel}</strong>
          ${r.kitten_status === 'present' ? '<span class="tag red">子猫あり</span>' : ''}
          ${r.has_ear_cut ? '<span class="tag green">耳カット済</span>' : ''}
          ${problemTags ? `<div class="popup-section"><div class="popup-section-label">問題内容</div>${problemTags}</div>` : ''}
          ${requestTags ? `<div class="popup-section"><div class="popup-section-label">要望</div>${requestTags}</div>` : ''}
          ${r.notes ? `<p>${escapeHtml(r.notes)}</p>` : ''}
          <small>${new Date(r.reported_at).toLocaleDateString('ja-JP')}</small>
        </div>`
        const m = L.marker([r.latitude, r.longitude], { icon: reportIcon })
          .bindPopup(popupHtml, { maxWidth: 260 })
          .addTo(map.current)
        layersRef.current.push(m)
      })

      hs.forEach((h) => {
        const m = L.marker([h.latitude, h.longitude], { icon: hotspotIcon(h) })
          .on('click', () => onHotspotClick(h))
          .addTo(map.current)
        layersRef.current.push(m)
      })
    } finally {
      setLoading(false)
    }
  }, [onHotspotClick])

  useEffect(() => {
    if (map.current || !mapContainer.current) return
    const initial = getInitialView()
    map.current = L.map(mapContainer.current).setView(initial.center, initial.zoom)
    L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map.current)

    const hasSavedView = !!localStorage.getItem('nicox:mapView')

    const persist = () => {
      const c = map.current.getCenter()
      saveView([c.lat, c.lng], map.current.getZoom())
    }
    map.current.on('moveend', persist)
    map.current.on('zoomend', persist)

    const locateBtn = L.control({ position: 'topright' })
    locateBtn.onAdd = () => {
      const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control')
      div.innerHTML = `<a href="#" title="現在地" class="leaflet-icon-btn">${LOCATE_ICON_SVG}</a>`
      L.DomEvent.disableClickPropagation(div)
      div.onclick = (e) => {
        e.preventDefault()
        userRequestedLocate.current = true
        map.current.locate({ setView: true, maxZoom: 16, enableHighAccuracy: true })
      }
      return div
    }
    locateBtn.addTo(map.current)

    map.current.on('locationfound', (e) => {
      const { lat, lng } = e.latlng
      if (userMarker.current) {
        userMarker.current.setLatLng([lat, lng])
        accuracyCircle.current.setLatLng([lat, lng]).setRadius(e.accuracy)
      } else {
        userMarker.current = L.marker([lat, lng], { icon: userLocationIcon, interactive: false })
          .addTo(map.current)
        accuracyCircle.current = L.circle([lat, lng], {
          radius: e.accuracy,
          weight: 1,
          color: '#4285f4',
          fillColor: '#4285f4',
          fillOpacity: 0.1,
          interactive: false,
        }).addTo(map.current)
      }
    })

    map.current.on('locationerror', (e) => {
      // Only surface an error for an explicit button press; stay silent for the
      // automatic locate on open (e.g. permission not yet granted / unavailable).
      if (userRequestedLocate.current) {
        userRequestedLocate.current = false
        alert('現在地を取得できませんでした: ' + e.message)
      }
    })

    map.current.on('click', (e) => {
      if (e.originalEvent?.target?.closest?.('.leaflet-marker-icon')) return
      setSelected(null)
    })
    // Show the current-location marker automatically on open (no button press
    // needed). Only re-center the map on the very first visit, so a returning
    // user keeps their last viewed area.
    map.current.locate({ setView: !hasSavedView, maxZoom: 16, enableHighAccuracy: true })

    plotData()
    setTimeout(() => map.current?.invalidateSize(), 100)

    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [plotData])

  const galleryImages = hotspotReports.flatMap((r) =>
    (r.media_urls || []).map((url) => ({ url, report: r }))
  )

  return (
    <div className="map-view">
      <div className="map-container" ref={mapContainer} />

      {loading && <div className="map-loading">読み込み中...</div>}

      <div className="legend">
        <div className="legend-row"><span className="legend-dot" style={{ background: '#e74c3c' }} /> 要対応（子猫）</div>
        <div className="legend-row"><span className="legend-dot" style={{ background: '#f39c12' }} /> 未去勢</div>
        <div className="legend-row"><span className="legend-dot" style={{ background: '#27ae60' }} /> 管理済</div>
        <div className="legend-row"><span className="legend-dot report" /> 通報</div>
      </div>

      <button className="refresh-btn" onClick={plotData} disabled={loading} title="再読み込み">
        <RefreshCw size={18} strokeWidth={2.2} className={loading ? 'spin' : ''} />
      </button>

      {selected && (
        <>
          <div className="panel-backdrop" onClick={() => setSelected(null)} />
          <div className="hotspot-panel">
            <button className="close-btn" onClick={() => setSelected(null)} aria-label="閉じる">
              <X size={16} strokeWidth={2.5} />
            </button>
            <div className="panel-tag">
              <HotspotLabel hotspot={selected} color={hotspotColor(selected)} />
            </div>
            <h3>推定 {selected.cat_count_estimate ?? '?'} 匹</h3>
            <div className="panel-row"><span>通報件数</span><strong>{selected.report_count}</strong></div>
            <div className="panel-row">
              <span>子猫</span>
              <strong>
                {selected.has_kitten ? (
                  <span className="strong-with-icon">あり <Baby size={14} strokeWidth={2.5} color="#e74c3c" /></span>
                ) : (
                  'なし'
                )}
              </strong>
            </div>
            <div className="panel-row"><span>耳カット</span><strong>{selected.has_ear_cut_visible ? '確認済' : '未確認'}</strong></div>
            <div className="panel-row"><span>介入回数</span><strong>{selected.intervention_count ?? 0}</strong></div>
            <div className="panel-row"><span>最終確認</span><strong>{new Date(selected.last_seen_at).toLocaleDateString('ja-JP')}</strong></div>

            <div className="gallery-section">
              <div className="gallery-title">
                写真 {galleryImages.length > 0 && `(${galleryImages.length})`}
              </div>
              {detailLoading && <div className="gallery-loading">読み込み中...</div>}
              {!detailLoading && galleryImages.length === 0 && (
                <div className="gallery-empty">この地点の通報には写真がありません</div>
              )}
              {!detailLoading && galleryImages.length > 0 && (
                <div className="gallery-grid">
                  {galleryImages.map(({ url, report }, idx) => (
                    <a key={`${url}-${idx}`} href={url} target="_blank" rel="noopener noreferrer" className="gallery-item">
                      <img src={url} alt={`通報 #${report.id}`} loading="lazy" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
