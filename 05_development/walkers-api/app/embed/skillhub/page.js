'use client'
import { useState, useEffect, useCallback } from 'react'

const CATEGORIES = {
  all: '全て', content: 'コンテンツ作成', sales: '営業・経理',
  schedule: 'スケジュール', research: '調査・分析', system: 'システム'
}
const CAT_COLORS = {
  content: '#3b82f6', sales: '#10b981', schedule: '#f59e0b',
  research: '#8b5cf6', system: '#6b7280'
}

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

function renderMarkdown(text) {
  if (!text) return ''
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3 style="color:var(--accent);margin:18px 0 6px;font-size:14px">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="color:var(--accent);margin:22px 0 8px;font-size:16px;border-bottom:1px solid var(--border);padding-bottom:4px">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="color:var(--accent);margin:0 0 12px;font-size:20px">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.08);padding:1px 5px;border-radius:3px;font-size:12px">$1</code>')
    .replace(/^- (.+)$/gm, '<div style="padding-left:16px;margin:2px 0">&bull; $1</div>')
    .replace(/^\d+\. (.+)$/gm, (m, p1) => {
      const num = m.match(/^(\d+)/)[1]
      return `<div style="padding-left:16px;margin:2px 0">${num}. ${p1}</div>`
    })
    .replace(/```([\s\S]*?)```/g, '<pre style="background:rgba(0,0,0,0.3);padding:12px;border-radius:6px;margin:8px 0;overflow-x:auto;font-size:12px">$1</pre>')
    .replace(/^\|(.+)\|$/gm, (match) => {
      const cells = match.split('|').filter(c => c.trim())
      if (cells.every(c => /^[\s-:]+$/.test(c))) return ''
      return '<div style="display:flex;gap:0;margin:1px 0">' +
        cells.map(c => `<span style="flex:1;padding:4px 8px;border:1px solid var(--border);font-size:12px">${c.trim()}</span>`).join('') +
        '</div>'
    })
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>')
}

export default function SkillHubEmbed() {
  const [skills, setSkills] = useState([])
  const [filterCat, setFilterCat] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedSkill, setSelectedSkill] = useState(null)
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
    apiFetch('/skills')
      .then(data => { setSkills(data.skills || []); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [auth, apiFetch])

  const handleDelete = async (id) => {
    if (!confirm('このスキルをSkill Hubから取り下げますか？')) return
    try {
      await apiFetch(`/skills/${encodeURIComponent(id)}`, { method: 'DELETE' })
      showToast('取り下げました')
      const result = await apiFetch('/skills')
      setSkills(result.skills || [])
      setSelectedSkill(null)
    } catch (e) {
      showToast('エラー: ' + e.message, 'error')
    }
  }

  const handleInstall = (skill) => {
    // postMessage to parent (local dashboard) to trigger install
    window.parent.postMessage({
      type: 'skillhub-install',
      skill: { name: skill.name, content: skill.content }
    }, '*')
    showToast(`/${skill.name} のインストールをリクエストしました`)
  }

  if (loading) return <div style={{padding:'2rem',textAlign:'center',opacity:.5}}>読み込み中...</div>
  if (error) return <div className="empty-state"><div className="empty-state-icon">&#x26a0;&#xfe0f;</div><div className="empty-state-msg">エラー: {error}</div></div>

  const filtered = skills.filter(s => {
    const cat = s.category || 'system'
    const matchCat = filterCat === 'all' || cat === filterCat
    const matchSearch = !searchTerm ||
      (s.name || '').toLowerCase().includes(searchTerm) ||
      (s.description || '').toLowerCase().includes(searchTerm) ||
      (s.tags || []).join(' ').toLowerCase().includes(searchTerm) ||
      (s.config?.triggers || '').toLowerCase().includes(searchTerm)
    return matchCat && matchSearch
  })

  return (
    <>
      <div className="panel-header">
        <div>
          <h2>Skill Hub</h2>
          <p style={{opacity:.6,fontSize:'13px',marginTop:'4px'}}>社内スキル共有マーケットプレイス — {skills.length}スキル掲載中</p>
        </div>
        <span style={{display:'inline-flex',alignItems:'center',gap:'4px',fontSize:'11px',padding:'3px 10px',borderRadius:'12px',background:'rgba(16,185,129,0.15)',color:'#10b981'}}>
          <span style={{width:'6px',height:'6px',borderRadius:'50%',background:'#10b981',display:'inline-block'}}></span>
          Cloud同期中
        </span>
      </div>

      {skills.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">&#x1f4e6;</div>
          <div className="empty-state-msg">まだスキルが掲載されていません</div>
        </div>
      ) : (
        <>
          <div className="filter-bar">
            {Object.entries(CATEGORIES).map(([k, v]) => (
              <button key={k} className={`filter-btn ${filterCat === k ? 'active' : ''}`} onClick={() => setFilterCat(k)}>{v}</button>
            ))}
          </div>

          <input type="text" className="search-input" placeholder="スキルを検索..." value={searchTerm} onChange={e => setSearchTerm(e.target.value.toLowerCase())} />

          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(340px,1fr))',gap:'16px'}}>
            {filtered.map(s => {
              const cat = s.category || 'system'
              const catColor = CAT_COLORS[cat] || '#6b7280'
              const catLabel = CATEGORIES[cat] || 'システム'
              const initials = (s.created_by || '?').slice(0, 1)
              const triggers = s.config?.triggers || ''
              const lines = s.config?.lines || null
              const phases = s.config?.phases || null
              return (
                <div key={s.id} className="card" style={{padding:'16px',display:'flex',flexDirection:'column',gap:'8px',cursor:'pointer',transition:'transform 0.1s,box-shadow 0.15s'}}
                  onClick={() => setSelectedSkill(s)}
                  onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)' }}
                  onMouseOut={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '' }}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <span style={{fontWeight:600,color:'var(--accent)',fontSize:'15px'}}>/{s.name}</span>
                    <span style={{fontSize:'11px',padding:'2px 8px',borderRadius:'10px',background:`${catColor}22`,color:catColor,border:`1px solid ${catColor}44`}}>{catLabel}</span>
                  </div>
                  {triggers && <p style={{fontSize:'13px',opacity:.7,margin:0,lineHeight:1.5,fontFamily:'monospace',fontSize:'12px'}}>トリガー: 「{triggers}」</p>}
                  <p style={{fontSize:'13px',opacity:.8,margin:0,lineHeight:1.5}}>{s.description || ''}</p>
                  <div style={{display:'flex',alignItems:'center',gap:'8px',marginTop:'4px'}}>
                    <div style={{width:'28px',height:'28px',borderRadius:'50%',background:'var(--accent)',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'13px',fontWeight:600,flexShrink:0}}>{initials}</div>
                    <div>
                      <div style={{fontSize:'13px',fontWeight:500}}>{s.created_by || '不明'}</div>
                      <div style={{fontSize:'11px',opacity:.4}}>{formatDate(s.created_at)} 掲載</div>
                    </div>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'auto',paddingTop:'8px',borderTop:'1px solid var(--border)'}}>
                    <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
                      {phases && <span style={{fontSize:'11px',opacity:.5}}>{phases} セクション</span>}
                      {lines && <span style={{fontSize:'11px',opacity:.5}}>{lines} 行</span>}
                      {(s.tags || []).map((tag, i) => <span key={i} className="tech-tag">{tag}</span>)}
                    </div>
                    <button className="btn" style={{fontSize:'12px',padding:'4px 10px',color:'var(--danger)',borderColor:'var(--danger)'}}
                      onClick={e => { e.stopPropagation(); handleDelete(s.id) }}>取り下げ</button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Skill Detail Modal */}
      {selectedSkill && (
        <div className="modal" style={{display:'flex'}} onClick={e => { if (e.target === e.currentTarget) setSelectedSkill(null) }}>
          <div className="modal-content" style={{maxWidth:'800px',maxHeight:'85vh',display:'flex',flexDirection:'column',overflow:'hidden'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'16px',flexShrink:0}}>
              <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
                <h3 style={{color:'var(--text-heading)',margin:0}}>/{selectedSkill.name}</h3>
                {(() => {
                  const cat = selectedSkill.category || 'system'
                  const catColor = CAT_COLORS[cat] || '#6b7280'
                  return <span style={{fontSize:'11px',padding:'2px 8px',borderRadius:'10px',background:`${catColor}22`,color:catColor,border:`1px solid ${catColor}44`}}>{CATEGORIES[cat] || cat}</span>
                })()}
              </div>
              <div style={{display:'flex',gap:'8px'}}>
                {selectedSkill.content && (
                  <button className="btn btn-primary" style={{fontSize:'12px',padding:'6px 14px'}} onClick={() => handleInstall(selectedSkill)}>インストール</button>
                )}
                <button className="btn" onClick={() => setSelectedSkill(null)}>閉じる</button>
              </div>
            </div>

            {/* Meta info */}
            <div style={{display:'flex',gap:'16px',fontSize:'13px',color:'var(--text-muted)',marginBottom:'16px',flexWrap:'wrap',flexShrink:0}}>
              <span>作成者: <strong style={{color:'var(--text-heading)'}}>{selectedSkill.created_by || '不明'}</strong></span>
              {selectedSkill.config?.triggers && <span>トリガー: <strong style={{color:'var(--text-heading)'}}>{selectedSkill.config.triggers}</strong></span>}
              {selectedSkill.config?.phases && <span>{selectedSkill.config.phases} セクション</span>}
              {selectedSkill.config?.lines && <span>{selectedSkill.config.lines} 行</span>}
              <span>{formatDate(selectedSkill.created_at)} 掲載</span>
            </div>

            {/* Content body */}
            <div style={{flex:1,overflowY:'auto',borderTop:'1px solid var(--border)',paddingTop:'16px'}}>
              {selectedSkill.content ? (
                <div
                  style={{fontFamily:"'SF Mono','Fira Code','Menlo',monospace",fontSize:'13px',lineHeight:1.7,color:'var(--text)'}}
                  dangerouslySetInnerHTML={{__html: renderMarkdown(selectedSkill.content)}}
                />
              ) : (
                <div style={{textAlign:'center',padding:'2rem',opacity:.5}}>
                  <p>スキル本文は未登録です</p>
                  <p style={{fontSize:'12px'}}>再掲載すると本文も表示されます</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
