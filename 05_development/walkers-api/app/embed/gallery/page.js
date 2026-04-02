'use client'
import { useState, useEffect, useCallback } from 'react'

const TYPE_COLORS = {
  webapp: '#3b82f6', gui: '#f59e0b', extension: '#8b5cf6',
  script: '#10b981', mcp: '#06b6d4', gas: '#ef4444', slides: '#6366f1'
}
const TYPE_LABELS = {
  all: '全て', webapp: 'Webアプリ', gui: 'GUI', extension: '拡張機能',
  script: 'スクリプト', mcp: 'MCP', gas: 'GAS', slides: 'スライド'
}

function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }

function formatDate(d) {
  if (!d) return ''
  const dt = new Date(d)
  return `${dt.getMonth()+1}/${dt.getDate()}`
}

function showToast(msg, type = 'success') {
  let el = document.getElementById('embed-toast')
  if (!el) {
    el = document.createElement('div')
    el.id = 'embed-toast'
    el.className = 'toast'
    document.body.appendChild(el)
  }
  el.textContent = msg
  el.className = `toast toast-${type} show`
  setTimeout(() => el.classList.remove('show'), 3000)
}

export default function GalleryEmbed() {
  const [items, setItems] = useState([])
  const [filterType, setFilterType] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showRegister, setShowRegister] = useState(false)
  const [auth, setAuth] = useState({ key: '', machine: '' })

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setAuth({ key: params.get('key') || '', machine: params.get('machine') || '' })
  }, [])

  const apiFetch = useCallback(async (path, opts = {}) => {
    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': auth.key,
      'X-Machine-Id': auth.machine,
      ...opts.headers
    }
    const res = await fetch(`/api${path}`, { ...opts, headers })
    if (!res.ok) throw new Error(`API error: ${res.status}`)
    return res.json()
  }, [auth])

  useEffect(() => {
    if (!auth.key) return
    setLoading(true)
    apiFetch('/gallery')
      .then(data => { setItems(data.items || []); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [auth, apiFetch])

  const handleRegister = async (e) => {
    e.preventDefault()
    const form = e.target
    const data = {
      id: `gallery-${Date.now()}`,
      title: form.title.value,
      description: form.description.value || null,
      category: form.category.value || null,
      url: form.url.value || null,
      tags: form.tags.value ? form.tags.value.split(',').map(t => t.trim()) : [],
      metadata: {
        creator: form.creator.value || null,
        tech: form.tech.value ? form.tech.value.split(',').map(t => t.trim()) : []
      }
    }
    try {
      await apiFetch('/gallery', { method: 'POST', body: JSON.stringify(data) })
      showToast('登録しました')
      setShowRegister(false)
      const result = await apiFetch('/gallery')
      setItems(result.items || [])
    } catch (e) {
      showToast('エラー: ' + e.message, 'error')
    }
  }

  const handleDelete = async (id, title) => {
    if (!confirm(`「${title}」を削除しますか？`)) return
    try {
      await apiFetch(`/gallery/${encodeURIComponent(id)}`, { method: 'DELETE' })
      showToast('削除しました')
      const result = await apiFetch('/gallery')
      setItems(result.items || [])
    } catch (e) {
      showToast('エラー: ' + e.message, 'error')
    }
  }

  if (loading) return <div style={{padding:'2rem',textAlign:'center',opacity:.5}}>読み込み中...</div>
  if (error) return <div className="empty-state"><div className="empty-state-icon">&#x26a0;&#xfe0f;</div><div className="empty-state-msg">エラー: {error}</div></div>

  const filtered = items.filter(item => {
    const matchType = filterType === 'all' || (item.category || item.metadata?.type) === filterType
    const matchSearch = !searchTerm ||
      (item.title || '').toLowerCase().includes(searchTerm) ||
      (item.description || '').toLowerCase().includes(searchTerm) ||
      (item.metadata?.creator || '').toLowerCase().includes(searchTerm) ||
      (item.tags || []).join(' ').toLowerCase().includes(searchTerm)
    return matchType && matchSearch
  })

  const typeCounts = {}
  items.forEach(i => { const t = i.category || 'other'; typeCounts[t] = (typeCounts[t] || 0) + 1 })
  const types = ['all', ...new Set(items.map(i => i.category).filter(Boolean))]
  const creators = new Set(items.map(i => i.metadata?.creator || i.created_by).filter(Boolean))

  return (
    <>
      <div className="panel-header">
        <div>
          <h2>ギャラリー</h2>
          <p style={{opacity:.6,fontSize:'13px',marginTop:'4px'}}>チーム成果物共有プラットフォーム</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowRegister(true)}>+ 登録</button>
      </div>

      <div className="metrics">
        <div className="metric-card"><div className="metric-value">{items.length}</div><div className="metric-label">合計</div></div>
        <div className="metric-card"><div className="metric-value">{creators.size}</div><div className="metric-label">作成者</div></div>
        {Object.entries(typeCounts).slice(0, 4).map(([type, count]) => (
          <div key={type} className="metric-card"><div className="metric-value">{count}</div><div className="metric-label">{TYPE_LABELS[type] || type}</div></div>
        ))}
      </div>

      <div className="filter-bar">
        {types.map(t => (
          <button key={t} className={`filter-btn ${filterType === t ? 'active' : ''}`} onClick={() => setFilterType(t)}>
            {TYPE_LABELS[t] || t}
          </button>
        ))}
      </div>

      <input type="text" className="search-input" placeholder="名前・作成者・技術で検索..." value={searchTerm} onChange={e => setSearchTerm(e.target.value.toLowerCase())} />

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">&#x1f3a8;</div>
          <div className="empty-state-msg">成果物がまだありません<br/><span style={{fontSize:'13px',opacity:.6}}>「+ 登録」から成果物を追加してください</span></div>
        </div>
      ) : (
        <table className="gallery-table">
          <thead><tr>
            <th>名前</th><th>作成者</th><th>カテゴリ</th><th>技術</th><th>URL</th><th>更新日</th><th></th>
          </tr></thead>
          <tbody>
            {filtered.map(item => {
              const creator = item.metadata?.creator || item.created_by || ''
              const tech = item.metadata?.tech || item.tags || []
              const typeColor = TYPE_COLORS[item.category] || '#6b7280'
              const typeLabel = TYPE_LABELS[item.category] || item.category || '—'
              return (
                <tr key={item.id}>
                  <td>
                    <strong style={{color:'var(--text-heading)'}}>{item.title}</strong>
                    {item.description && <><br/><span style={{fontSize:'11px',opacity:.5}}>{item.description}</span></>}
                  </td>
                  <td>
                    {creator ? (
                      <div className="creator-cell">
                        <span className="creator-avatar">{creator.charAt(0).toUpperCase()}</span>
                        <span style={{fontWeight:600}}>{creator}</span>
                      </div>
                    ) : <span style={{color:'var(--danger)',fontSize:'12px'}}>未設定</span>}
                  </td>
                  <td><span className="type-badge" style={{background:`${typeColor}22`,color:typeColor,border:`1px solid ${typeColor}44`}}>{typeLabel}</span></td>
                  <td>{tech.map((t,i) => <span key={i} className="tech-tag">{t}</span>)}</td>
                  <td>{item.url ? <a href={item.url} target="_blank" rel="noreferrer" style={{color:'var(--accent)',fontSize:'12px'}}>&#x1f517; リンク</a> : <span style={{opacity:.3}}>—</span>}</td>
                  <td style={{fontSize:'12px',whiteSpace:'nowrap'}}>{formatDate(item.updated_at)}</td>
                  <td>
                    <button className="btn" style={{fontSize:'11px',padding:'3px 8px',color:'var(--danger)',borderColor:'var(--danger)'}}
                      onClick={() => handleDelete(item.id, item.title)}>削除</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {/* Register Modal */}
      {showRegister && (
        <div className="modal" style={{display:'flex'}} onClick={e => { if (e.target === e.currentTarget) setShowRegister(false) }}>
          <div className="modal-content">
            <h3 style={{marginBottom:'16px',color:'var(--text-heading)'}}>成果物を登録</h3>
            <form onSubmit={handleRegister}>
              <div className="form-group"><label>名前 *</label><input name="title" required /></div>
              <div className="form-group"><label>作成者</label><input name="creator" /></div>
              <div className="form-group"><label>説明</label><textarea name="description" /></div>
              <div className="form-group">
                <label>カテゴリ</label>
                <select name="category">
                  <option value="">選択してください</option>
                  {Object.entries(TYPE_LABELS).filter(([k]) => k !== 'all').map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="form-group"><label>技術（カンマ区切り）</label><input name="tech" placeholder="Next.js, Tailwind, Python..." /></div>
              <div className="form-group"><label>URL</label><input name="url" type="url" /></div>
              <div className="form-group"><label>タグ（カンマ区切り）</label><input name="tags" /></div>
              <div style={{display:'flex',gap:'8px',justifyContent:'flex-end'}}>
                <button type="button" className="btn" onClick={() => setShowRegister(false)}>キャンセル</button>
                <button type="submit" className="btn btn-primary">登録</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
