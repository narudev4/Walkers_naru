import { sql } from '../../../../lib/db'
import { authenticate, unauthorized } from '../../../../lib/auth'
export { OPTIONS } from '../../../../lib/cors'

// GET /api/gateway/{machineId} — Get gateway status + pending commands for a machine
export async function GET(request, { params }) {
  const auth = authenticate(request)
  if (!auth.ok) return unauthorized(auth.error, auth.status)

  const { machineId } = await params
  const db = sql()

  // Get machine info
  const machines = await db`
    SELECT *, CASE WHEN last_heartbeat > NOW() - INTERVAL '5 minutes' THEN true ELSE false END as is_online
    FROM machines WHERE machine_id = ${machineId}
  `
  if (!machines.length) return Response.json({ error: 'Machine not found' }, { status: 404 })

  // Get pending commands
  const pending = await db`
    SELECT * FROM gateway_commands
    WHERE machine_id = ${machineId} AND status = 'pending'
    ORDER BY created_at ASC
  `

  // Get recent completed commands
  const recent = await db`
    SELECT * FROM gateway_commands
    WHERE machine_id = ${machineId} AND status != 'pending'
    ORDER BY created_at DESC LIMIT 20
  `

  return Response.json({
    machine: machines[0],
    pendingCommands: pending,
    recentCommands: recent,
  })
}

// POST /api/gateway/{machineId} — Send a command to be relayed to the machine
export async function POST(request, { params }) {
  const auth = authenticate(request)
  if (!auth.ok) return unauthorized(auth.error, auth.status)

  const { machineId } = await params
  const body = await request.json()
  const prompt = (body.prompt || '').trim()

  if (!prompt) return Response.json({ error: 'prompt is required' }, { status: 400 })

  const db = sql()

  // Verify machine exists
  const machines = await db`SELECT machine_id FROM machines WHERE machine_id = ${machineId}`
  if (!machines.length) return Response.json({ error: 'Machine not found' }, { status: 404 })

  // Generate command ID
  const cmdId = `gw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

  await db`
    INSERT INTO gateway_commands (id, machine_id, prompt, source, created_by)
    VALUES (${cmdId}, ${machineId}, ${prompt}, ${body.source || 'remote'}, ${auth.machineId})
  `

  return Response.json({ ok: true, commandId: cmdId })
}
