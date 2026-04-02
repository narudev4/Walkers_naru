'use client'
import { useState, useEffect, useRef } from 'react'

export default function ChatEmbed() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [machines, setMachines] = useState([])
  const [selectedMachine, setSelectedMachine] = useState('')
  const [loading, setLoading] = useState(false)
  const [polling, setPolling] = useState({})
  const messagesEndRef = useRef(null)

  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
  const apiKey = params?.get('key') || ''
  const machineId = params?.get('machine') || ''

  const headers = { 'Content-Type': 'application/json', 'X-API-Key': apiKey, 'X-Machine-Id': machineId }
  const baseUrl = ''

  useEffect(() => {
    fetchMachines()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function fetchMachines() {
    try {
      const res = await fetch(`${baseUrl}/api/machines`, { headers })
      const data = await res.json()
      const list = Array.isArray(data) ? data : data.machines || []
      setMachines(list.filter(m => m.is_online))
      if (list.length > 0 && !selectedMachine) {
        setSelectedMachine(list[0].machine_id)
      }
    } catch (e) { console.error('Failed to load machines', e) }
  }

  async function sendMessage() {
    const prompt = input.trim()
    if (!prompt || !selectedMachine) return

    setInput('')
    setLoading(true)

    const userMsg = { role: 'user', content: prompt, timestamp: new Date().toISOString() }
    setMessages(prev => [...prev, userMsg])

    try {
      const res = await fetch(`${baseUrl}/api/gateway/${selectedMachine}`, {
        method: 'POST', headers,
        body: JSON.stringify({ prompt, source: 'chat-embed' })
      })
      const data = await res.json()

      if (data.ok && data.commandId) {
        const pendingMsg = { role: 'system', content: '\u23F3 \u30B3\u30DE\u30F3\u30C9\u3092\u9001\u4FE1\u3057\u307E\u3057\u305F\u3002\u5B9F\u884C\u7D50\u679C\u3092\u5F85\u3063\u3066\u3044\u307E\u3059...', commandId: data.commandId, timestamp: new Date().toISOString() }
        setMessages(prev => [...prev, pendingMsg])
        pollResult(data.commandId, selectedMachine)
      } else {
        setMessages(prev => [...prev, { role: 'error', content: data.error || 'Failed to send', timestamp: new Date().toISOString() }])
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'error', content: e.message, timestamp: new Date().toISOString() }])
    }
    setLoading(false)
  }

  async function pollResult(commandId, targetMachine) {
    const maxAttempts = 120  // 10 minutes
    let attempts = 0

    const interval = setInterval(async () => {
      attempts++
      if (attempts > maxAttempts) {
        clearInterval(interval)
        setMessages(prev => prev.map(m =>
          m.commandId === commandId ? { ...m, role: 'error', content: '\u23F0 \u30BF\u30A4\u30E0\u30A2\u30A6\u30C8 \u2014 \u5B9F\u884C\u306B\u6642\u9593\u304C\u304B\u304B\u308A\u3059\u304E\u3066\u3044\u307E\u3059' } : m
        ))
        return
      }

      try {
        const res = await fetch(`${baseUrl}/api/gateway/${targetMachine}/${commandId}`, { headers })
        const data = await res.json()

        if (data.status === 'done' || data.status === 'failed') {
          clearInterval(interval)
          const result = typeof data.result === 'string' ? JSON.parse(data.result) : (data.result || {})
          const output = result.output || result.error || JSON.stringify(result)
          setMessages(prev => prev.map(m =>
            m.commandId === commandId ? { role: data.status === 'done' ? 'assistant' : 'error', content: output, timestamp: data.completed_at || new Date().toISOString() } : m
          ))
        }
      } catch (e) { /* continue polling */ }
    }, 5000)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const machineLabel = (m) => `${m.machine_name || m.machine_id}${m.is_online ? ' \uD83D\uDFE2' : ' \uD83D\uDD34'}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg, #0d1117)' }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border, #21262d)', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text, #c9d1d9)' }}>{'\uD83D\uDDA5'} Gateway Chat</span>
        <select value={selectedMachine} onChange={e => setSelectedMachine(e.target.value)}
          style={{ marginLeft: 'auto', padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border, #21262d)', background: 'var(--bg-surface, #161b22)', color: 'var(--text, #c9d1d9)', fontSize: '13px' }}>
          {machines.map(m => <option key={m.machine_id} value={m.machine_id}>{machineLabel(m)}</option>)}
        </select>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 20px', opacity: 0.4 }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>{'\uD83E\uDD16'}</div>
            <div>{'\u30EA\u30E2\u30FC\u30C8\u30DE\u30B7\u30F3\u306B\u30E1\u30C3\u30BB\u30FC\u30B8\u3092\u9001\u4FE1\u3067\u304D\u307E\u3059'}</div>
            <div style={{ fontSize: '12px', marginTop: '8px' }}>{'\u9078\u629E\u3057\u305F\u30DE\u30B7\u30F3\u4E0A\u306EClaude\u304C\u30B3\u30DE\u30F3\u30C9\u3092\u5B9F\u884C\u3057\u307E\u3059'}</div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{
            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '80%',
            padding: '10px 14px',
            borderRadius: '12px',
            background: msg.role === 'user' ? 'var(--accent, #58a6ff)' : msg.role === 'error' ? 'rgba(248,81,73,0.1)' : 'var(--bg-surface, #161b22)',
            color: msg.role === 'user' ? '#fff' : msg.role === 'error' ? '#f85149' : 'var(--text, #c9d1d9)',
            border: msg.role === 'user' ? 'none' : '1px solid var(--border, #21262d)',
            fontSize: '14px', lineHeight: 1.6, whiteSpace: 'pre-wrap',
          }}>
            {msg.content}
            <div style={{ fontSize: '11px', opacity: 0.5, marginTop: '4px', textAlign: 'right' }}>
              {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('ja-JP') : ''}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border, #21262d)', display: 'flex', gap: '8px' }}>
        <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
          placeholder={'\u30E1\u30C3\u30BB\u30FC\u30B8\u3092\u5165\u529B... (Enter \u3067\u9001\u4FE1\u3001Shift+Enter \u3067\u6539\u884C)'}
          style={{
            flex: 1, padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border, #21262d)',
            background: 'var(--bg-surface, #161b22)', color: 'var(--text, #c9d1d9)', fontSize: '14px',
            resize: 'none', fontFamily: 'inherit', lineHeight: 1.5, minHeight: '44px', maxHeight: '120px',
          }}
          rows={1}
        />
        <button onClick={sendMessage} disabled={loading || !input.trim()}
          style={{
            padding: '10px 20px', borderRadius: '8px', border: 'none',
            background: loading ? 'var(--border, #21262d)' : 'var(--accent, #58a6ff)',
            color: '#fff', fontSize: '14px', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
          }}>
          {loading ? '...' : '\u9001\u4FE1'}
        </button>
      </div>
    </div>
  )
}
