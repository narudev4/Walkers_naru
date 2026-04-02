import { sql } from '../../../../../lib/db'
import { authenticate, unauthorized } from '../../../../../lib/auth'
export { OPTIONS } from '../../../../../lib/cors'

// GET /api/gateway/{machineId}/{commandId} — Get command status/result
export async function GET(request, { params }) {
  const auth = authenticate(request)
  if (!auth.ok) return unauthorized(auth.error, auth.status)

  const { machineId, commandId } = await params
  const db = sql()

  const rows = await db`
    SELECT * FROM gateway_commands
    WHERE id = ${commandId} AND machine_id = ${machineId}
  `
  if (!rows.length) return Response.json({ error: 'Command not found' }, { status: 404 })
  return Response.json(rows[0])
}

// PUT /api/gateway/{machineId}/{commandId} — Update command status (called by machine)
export async function PUT(request, { params }) {
  const auth = authenticate(request)
  if (!auth.ok) return unauthorized(auth.error, auth.status)

  const { machineId, commandId } = await params
  const body = await request.json()
  const db = sql()

  // Merge new result with existing result (preserves metadata like spaceName, threadName)
  const existing = await db`
    SELECT result FROM gateway_commands
    WHERE id = ${commandId} AND machine_id = ${machineId}
  `
  const existingResult = existing.length
    ? (typeof existing[0].result === 'string' ? JSON.parse(existing[0].result) : existing[0].result) || {}
    : {}
  const mergedResult = { ...existingResult, ...(body.result || {}) }

  const rows = await db`
    UPDATE gateway_commands SET
      status = ${body.status || 'done'},
      result = ${JSON.stringify(mergedResult)},
      completed_at = NOW()
    WHERE id = ${commandId} AND machine_id = ${machineId}
    RETURNING *
  `
  if (!rows.length) return Response.json({ error: 'Command not found' }, { status: 404 })
  return Response.json(rows[0])
}
