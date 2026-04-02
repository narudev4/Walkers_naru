import { sql } from '../../../../lib/db'
export { OPTIONS } from '../../../../lib/cors'

/**
 * Google Chat Bot Webhook Endpoint
 *
 * Supports TWO request formats:
 * 1. Classic Chat API: { type: "MESSAGE", message: {...}, space: {...} }
 *    Response: { text: "..." }
 * 2. Workspace Add-on format: { commonEventObject: {...}, chat: { messagePayload: {...} } }
 *    Response: { hostAppDataAction: { chatDataAction: { createMessageAction: { message: { text: "..." } } } } }
 */

const DEFAULT_MACHINE_ID = process.env.DEFAULT_GATEWAY_MACHINE || 'desktop-2h2gh54'

let _tableReady = false
async function ensureTable(db) {
  if (_tableReady) return
  try {
    await db`
      CREATE TABLE IF NOT EXISTS webhook_logs (
        id SERIAL PRIMARY KEY,
        source TEXT NOT NULL,
        event_type TEXT,
        payload TEXT,
        error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `
    _tableReady = true
  } catch { /* ignore */ }
}

/**
 * Build response in the correct format based on request type
 */
function chatResponse(text, isWorkspaceAddon) {
  if (isWorkspaceAddon) {
    return Response.json({
      hostAppDataAction: {
        chatDataAction: {
          createMessageAction: {
            message: { text }
          }
        }
      }
    })
  }
  // Classic format
  return Response.json({ text })
}

/**
 * Normalize Google Chat request into a unified format
 */
function normalizeRequest(body) {
  // Format 1: Classic Chat API (type at top level)
  if (body.type) {
    const attachments = body.message?.attachmentDataRef || body.message?.attachment || []
    return {
      isWorkspaceAddon: false,
      eventType: body.type,
      text: (body.message?.text || '').trim(),
      senderName: body.message?.sender?.displayName || '',
      senderEmail: body.message?.sender?.email || '',
      spaceName: body.space?.name || '',
      spaceDisplayName: body.space?.displayName || '',
      spaceType: body.space?.type || '',
      threadName: body.message?.thread?.name || '',
      messageId: body.message?.name || '',
      attachments: Array.isArray(attachments) ? attachments : (attachments ? [attachments] : []),
    }
  }

  // Format 2: Workspace Add-on format (chat.messagePayload)
  if (body.chat) {
    const chat = body.chat
    const msgPayload = chat.messagePayload || {}
    const message = msgPayload.message || {}
    const space = msgPayload.space || {}
    const user = chat.user || {}

    let eventType = 'MESSAGE'
    if (chat.addedToSpacePayload) eventType = 'ADDED_TO_SPACE'
    if (chat.removedFromSpacePayload) eventType = 'REMOVED_FROM_SPACE'
    if (chat.buttonClickedPayload) eventType = 'CARD_CLICKED'
    if (!msgPayload.message && !chat.addedToSpacePayload && !chat.removedFromSpacePayload) {
      eventType = 'UNKNOWN'
    }

    const attachments = message.attachmentDataRef || message.attachment || []

    return {
      isWorkspaceAddon: true,
      eventType,
      text: (message.text || message.argumentText || '').trim(),
      senderName: message.sender?.displayName || user.displayName || '',
      senderEmail: message.sender?.email || user.email || '',
      spaceName: space.name || '',
      spaceDisplayName: space.displayName || '',
      spaceType: space.type || space.spaceType || '',
      threadName: message.thread?.name || '',
      messageId: message.name || '',
      attachments: Array.isArray(attachments) ? attachments : (attachments ? [attachments] : []),
    }
  }

  return { isWorkspaceAddon: false, eventType: 'UNKNOWN', text: '', senderName: '', senderEmail: '', spaceName: '', spaceDisplayName: '', spaceType: '', threadName: '', messageId: '', attachments: [] }
}

// GET handler for health check / debug
export async function GET(request) {
  const db = sql()
  await ensureTable(db)
  const recent = await db`
    SELECT id, status, source, created_at FROM gateway_commands
    WHERE source = 'google-chat'
    ORDER BY created_at DESC LIMIT 5
  `
  let lastLog = null
  try {
    const logs = await db`
      SELECT * FROM webhook_logs ORDER BY created_at DESC LIMIT 5
    `
    lastLog = logs
  } catch { /* table may not exist */ }

  return Response.json({
    status: 'ok',
    endpoint: '/api/webhooks/google-chat',
    recentCommands: recent,
    webhookLogs: lastLog,
    timestamp: new Date().toISOString(),
  })
}

export async function POST(request) {
  const db = sql()
  await ensureTable(db)
  let rawBody = ''
  let body

  try {
    rawBody = await request.text()
    body = JSON.parse(rawBody)
  } catch (e) {
    try {
      await db`
        INSERT INTO webhook_logs (source, event_type, payload, error, created_at)
        VALUES ('google-chat', 'PARSE_ERROR', ${rawBody.slice(0, 2000)}, ${e.message}, NOW())
      `
    } catch { /* ignore */ }
    return Response.json({ text: 'Error parsing request' }, { status: 400 })
  }

  const evt = normalizeRequest(body)
  const headers = Object.fromEntries(request.headers.entries())

  // Log every incoming request
  try {
    await db`
      INSERT INTO webhook_logs (source, event_type, payload, error, created_at)
      VALUES (
        'google-chat',
        ${evt.eventType},
        ${JSON.stringify({
          normalized: evt,
          headers: {
            'content-type': headers['content-type'],
            'user-agent': headers['user-agent'],
            authorization: headers['authorization'] ? 'Bearer [REDACTED]' : 'none',
          },
          format: evt.isWorkspaceAddon ? 'workspace-addon' : 'classic',
        }).slice(0, 4000)},
        NULL,
        NOW()
      )
    `
  } catch { /* ignore */ }

  // Handle ADDED_TO_SPACE
  if (evt.eventType === 'ADDED_TO_SPACE') {
    return chatResponse(
      '🤖 Walkers Gateway Bot が接続されました。\nメッセージを送ると、常時稼働マシン上のClaude AIが実行します。',
      evt.isWorkspaceAddon
    )
  }

  if (evt.eventType === 'REMOVED_FROM_SPACE') {
    return new Response(null, { status: 200 })
  }

  if (evt.eventType !== 'MESSAGE') {
    return chatResponse(`Unknown event: ${evt.eventType}`, evt.isWorkspaceAddon)
  }

  try {
    // Strip bot mention prefix (e.g., "@Walkers Gateway Bot ")
    const cleanText = evt.text.replace(/^@\S+\s*/, '').trim()

    if (!cleanText) {
      return chatResponse('メッセージが空です。指示を入力してください。', evt.isWorkspaceAddon)
    }

    // Check if machine exists and is online
    const machines = await db`
      SELECT machine_id, machine_name,
        CASE WHEN last_heartbeat > NOW() - INTERVAL '5 minutes' THEN true ELSE false END as is_online
      FROM machines WHERE machine_id = ${DEFAULT_MACHINE_ID}
    `

    if (!machines.length || !machines[0].is_online) {
      return chatResponse(
        `⚠️ マシン (${DEFAULT_MACHINE_ID}) がオフラインです。\n常時稼働マシンが起動しているか確認してください。`,
        evt.isWorkspaceAddon
      )
    }

    // Create gateway command
    const cmdId = `gc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

    await db`
      INSERT INTO gateway_commands (id, machine_id, prompt, source, created_by, result)
      VALUES (
        ${cmdId},
        ${DEFAULT_MACHINE_ID},
        ${cleanText},
        'google-chat',
        ${evt.senderEmail || evt.senderName || 'unknown'},
        ${JSON.stringify({
          spaceName: evt.spaceName,
          spaceDisplayName: evt.spaceDisplayName,
          threadName: evt.threadName,
          senderName: evt.senderName,
          senderEmail: evt.senderEmail,
          messageId: evt.messageId,
          attachments: evt.attachments || [],
        })}
      )
    `

    // Return empty response — the local machine will send the "processing..." message
    // via Chat API using its own service account, then PATCH it with the final result.
    return Response.json({})
  } catch (e) {
    try {
      await db`
        INSERT INTO webhook_logs (source, event_type, payload, error, created_at)
        VALUES ('google-chat', 'PROCESSING_ERROR', ${rawBody.slice(0, 2000)}, ${e.message + '\n' + e.stack}, NOW())
      `
    } catch { /* ignore */ }

    return chatResponse(`❌ エラーが発生しました: ${e.message}`, evt.isWorkspaceAddon)
  }
}
