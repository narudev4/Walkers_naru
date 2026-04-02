import { sql } from '../../../../../lib/db'
import { authenticate, unauthorized } from '../../../../../lib/auth'
export { OPTIONS } from '../../../../../lib/cors'

/**
 * POST /api/webhooks/google-chat/reply
 *
 * Called by the local machine (or cron) to process completed google-chat commands
 * and send replies back to Google Chat via Chat API.
 *
 * Flow:
 * 1. Find gateway_commands with source='google-chat' and status='done'/'failed'
 *    that haven't been replied to yet
 * 2. For each, send a message to the original Google Chat space
 * 3. Mark as replied (update result JSON)
 *
 * Requires Google Chat API service account or user OAuth token.
 */

export async function POST(request) {
  const auth = authenticate(request)
  if (!auth.ok) return unauthorized(auth.error, auth.status)

  const body = await request.json().catch(() => ({}))
  const googleAccessToken = body.accessToken || process.env.GOOGLE_CHAT_ACCESS_TOKEN || ''

  if (!googleAccessToken) {
    return Response.json({ error: 'Google Chat access token required' }, { status: 400 })
  }

  const db = sql()

  // Find completed google-chat commands that haven't been replied
  const commands = await db`
    SELECT * FROM gateway_commands
    WHERE source = 'google-chat'
      AND status IN ('done', 'failed')
      AND (result->>'replied') IS NULL
    ORDER BY completed_at ASC
    LIMIT 10
  `

  if (!commands.length) {
    return Response.json({ ok: true, replied: 0, message: 'No pending replies' })
  }

  let replied = 0
  const errors = []

  for (const cmd of commands) {
    try {
      const result = typeof cmd.result === 'string' ? JSON.parse(cmd.result) : (cmd.result || {})
      const spaceName = result.spaceName || ''
      const threadName = result.threadName || ''

      if (!spaceName) {
        // No space info, mark as replied with error
        await db`
          UPDATE gateway_commands SET
            result = jsonb_set(COALESCE(result, '{}'), '{replied}', '"no-space-info"')
          WHERE id = ${cmd.id}
        `
        continue
      }

      // Build reply text
      let replyText
      if (cmd.status === 'done') {
        const output = result.output || '(出力なし)'
        replyText = `✅ 実行完了\n\n${output.slice(0, 4000)}`
      } else {
        const error = result.error || '不明なエラー'
        replyText = `❌ 実行失敗\n\n${error.slice(0, 1000)}`
      }

      // Send reply to Google Chat
      let chatUrl = `https://chat.googleapis.com/v1/${spaceName}/messages`
      const chatBody = { text: replyText }
      if (threadName) {
        chatBody.thread = { name: threadName }
        chatUrl += '?messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD'
      }

      const chatRes = await fetch(chatUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${googleAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chatBody),
      })

      if (chatRes.ok) {
        await db`
          UPDATE gateway_commands SET
            result = jsonb_set(COALESCE(result, '{}'), '{replied}', '"true"')
          WHERE id = ${cmd.id}
        `
        replied++
      } else {
        const errText = await chatRes.text()
        errors.push({ cmdId: cmd.id, error: `Chat API ${chatRes.status}: ${errText.slice(0, 200)}` })
        await db`
          UPDATE gateway_commands SET
            result = jsonb_set(COALESCE(result, '{}'), '{replied}', ${JSON.stringify(`error: ${chatRes.status}`)})
          WHERE id = ${cmd.id}
        `
      }
    } catch (e) {
      errors.push({ cmdId: cmd.id, error: e.message })
    }
  }

  return Response.json({ ok: true, replied, total: commands.length, errors })
}
