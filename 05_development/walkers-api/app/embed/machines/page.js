'use client'
import { useState, useEffect, useCallback } from 'react'

function formatDate(d) {
  if (!d) return '—'
  const dt = new Date(d)
  const now = new Date()
  const diff = now - dt
  if (diff < 60000) return 'たった今'
  if (diff < 3600000) return `${Math.floor(diff/60000)}分前`
  if (diff < 86400000) return `${Math.floor(diff/3600000)}時間前`
  return `${dt.getMonth()+1}/${dt.getDate()} ${dt.getHours()}:${String(dt.getMinutes()).padStart(2,'0')}`
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

export default function MachinesEmbed() {
  const [machines, setMachines] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
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

  const loadData = useCallback(async () => {
    try {
      const data = await apiFetch('/machines')
      setMachines(data.machines || [])
      setLoading(false)
    } catch (e) {
      setError(e.message)
      setLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    if (!auth.key) return
    setLoading(true)
    loadData()
  }, [auth, loadData])

  const handleDelete = async (id) => {
    if (!confirm('このマシンを削除しますか？')) return
    try {
      await apiFetch(`/machines/${encodeURIComponent(id)}`, { method: 'DELETE' })
      showToast('マシンを削除しました')
      if (expandedId === id) setExpandedId(null)
      loadData()
    } catch (e) {
      showToast('エラー: ' + e.message, 'error')
    }
  }

  const handleRegister = async (e) => {
    e.preventDefault()
    const form = e.target
    try {
      await apiFetch('/machines', {
        method: 'POST',
        body: JSON.stringify({
          machine_id: form.machine_id.value,
          machine_name: form.machine_name.value,
          description: form.description.value || null,
          host: form.host.value || null,
          port: parseInt(form.port.value) || 8080,
          access_scope: form.access_scope.value || 'select'
        })
      })
      showToast('マシンを登録しました')
      setShowRegister(false)
      loadData()
    } catch (e) {
      showToast('エラー: ' + e.message, 'error')
    }
  }

  if (loading) return <div style={{padding:'2rem',textAlign:'center',opacity:.5}}>読み込み中...</div>
  if (error) return <div className="empty-state"><div className="empty-state-icon">&#x26a0;&#xfe0f;</div><div className="empty-state-msg">エラー: {error}</div></div>

  // Determine online status based on heartbeat (within 5 minutes = online)
  const enriched = machines.map(m => {
    const lastHb = m.last_heartbeat ? new Date(m.last_heartbeat) : null
    const isOnline = lastHb && (Date.now() - lastHb < 5 * 60 * 1000) && m.is_online
    return { ...m, _online: isOnline }
  })
  const online = enriched.filter(m => m._online).length

  return (
    <>
      <div className="panel-header">
        <div>
          <h2>マシン管理</h2>
          <p style={{opacity:.6,fontSize:'13px',marginTop:'4px'}}>YourAIインスタンスの管理パネル</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowRegister(true)}>+ 共有マシンを追加</button>
      </div>

      <div className="metrics">
        <div className="metric-card"><div className="metric-value">{machines.length}</div><div className="metric-label">登録マシン</div></div>
        <div className="metric-card"><div className="metric-value">{online}</div><div className="metric-label">オンライン</div></div>
        <div className="metric-card"><div className="metric-value">{machines.length - online}</div><div className="metric-label">オフライン</div></div>
      </div>

      {machines.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">&#x1f5a5;</div>
          <div className="empty-state-msg">共有マシンが登録されていません</div>
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
          {enriched.map(m => {
            const statusColor = m._online ? 'var(--success)' : 'var(--danger)'
            const statusText = m._online ? 'オンライン' : 'オフライン'
            const accessLabel = m.access_scope === 'all' ? '全マシン（会社共有）' : m.access_scope === 'select' ? ((m.allowed_machines || []).join(', ') || '未設定') : '未設定'
            const isExpanded = expandedId === m.machine_id
            return (
              <div key={m.machine_id} style={{background:'var(--bg-card)',border:`1px solid ${isExpanded ? 'var(--accent)' : 'var(--border)'}`,borderRadius:'10px',padding:'16px 20px',transition:'border-color .2s'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',cursor:'pointer'}}
                  onClick={() => setExpandedId(isExpanded ? null : m.machine_id)}>
                  <div style={{flex:1}}>
                    <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'6px'}}>
                      <span style={{fontSize:'20px'}}>&#x1f5a5;</span>
                      <span style={{fontSize:'16px',fontWeight:700,color:'var(--text-heading)'}}>{m.machine_name}</span>
                      <span style={{display:'inline-block',width:'8px',height:'8px',borderRadius:'50%',background:statusColor}}></span>
                      <span style={{fontSize:'12px',color:statusColor,fontWeight:600}}>{statusText}</span>
                      <span style={{fontSize:'11px',opacity:.4,marginLeft:'4px'}}>{isExpanded ? '▲' : '▼'}</span>
                    </div>
                    {m.description && <div style={{fontSize:'13px',color:'var(--text-muted)',marginBottom:'8px',marginLeft:'30px'}}>{m.description}</div>}
                    <div style={{display:'flex',flexWrap:'wrap',gap:'16px',marginLeft:'30px',fontSize:'12px',color:'var(--text-muted)'}}>
                      <span>&#x1f465; アクセス: <strong style={{color:'var(--text-heading)'}}>{accessLabel}</strong></span>
                      <span>&#x1f552; 最終応答: <strong style={{color:'var(--text-heading)'}}>{formatDate(m.last_heartbeat)}</strong></span>
                      <span>&#x1f194; {m.machine_id}</span>
                      {m.host && <span>&#x1f310; {m.host}:{m.port || 8080}</span>}
                    </div>
                  </div>
                  <div style={{display:'flex',gap:'6px',flexShrink:0}} onClick={e => e.stopPropagation()}>
                    <button className="btn" style={{fontSize:'12px',padding:'4px 10px',color:'var(--danger)'}} onClick={() => handleDelete(m.machine_id)}>削除</button>
                  </div>
                </div>
                {isExpanded && (
                  <div style={{marginTop:'16px',paddingTop:'16px',borderTop:'1px solid var(--border)'}}>
                    <div style={{fontSize:'13px',color:'var(--text-muted)'}}>
                      <p>&#x1f4cb; 詳細情報</p>
                      <div style={{display:'grid',gridTemplateColumns:'120px 1fr',gap:'8px',marginTop:'8px',fontSize:'12px'}}>
                        <span style={{opacity:.6}}>Machine ID:</span><span>{m.machine_id}</span>
                        <span style={{opacity:.6}}>ホスト:</span><span>{m.host || '—'}:{m.port || 8080}</span>
                        <span style={{opacity:.6}}>アクセス範囲:</span><span>{m.access_scope || '—'}</span>
                        <span style={{opacity:.6}}>登録日:</span><span>{formatDate(m.created_at)}</span>
                        <span style={{opacity:.6}}>最終更新:</span><span>{formatDate(m.updated_at)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Register Modal */}
      {showRegister && (
        <div className="modal" style={{display:'flex'}} onClick={e => { if (e.target === e.currentTarget) setShowRegister(false) }}>
          <div className="modal-content">
            <h3 style={{marginBottom:'16px',color:'var(--text-heading)'}}>共有マシンを追加</h3>
            <form onSubmit={handleRegister}>
              <div className="form-group"><label>マシンID *</label><input name="machine_id" required placeholder="例: desktop-abc123" /></div>
              <div className="form-group"><label>マシン名 *</label><input name="machine_name" required placeholder="例: Office-Server" /></div>
              <div className="form-group"><label>説明</label><input name="description" placeholder="例: 常時稼働のWindowsサーバー" /></div>
              <div className="form-group"><label>ホスト</label><input name="host" placeholder="例: 192.168.1.100" /></div>
              <div className="form-group"><label>ポート</label><input name="port" type="number" defaultValue={8080} /></div>
              <div className="form-group">
                <label>アクセス範囲</label>
                <select name="access_scope">
                  <option value="select">選択したマシンのみ</option>
                  <option value="all">全マシン（会社共有）</option>
                </select>
              </div>
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
