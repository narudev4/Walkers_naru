import { sql } from '../../../../lib/db'
import { authenticate, unauthorized } from '../../../../lib/auth'
export { OPTIONS } from '../../../../lib/cors'

// GET /api/gateway/poll — Machine polls for pending commands
export async function GET(request) {
  const auth = authenticate(request)
  if (!auth.ok) return unauthorized(auth.error, auth.status)

  const db = sql()
  const machineId = auth.machineId

  // Get pending commands for this machine
  const pending = await db`
    SELECT * FROM gateway_commands
    WHERE machine_id = ${machineId} AND status = 'pending'
    ORDER BY created_at ASC
    LIMIT 10
  `

  // Mark as 'running'
  if (pending.length > 0) {
    const ids = pending.map(c => c.id)
    await db`UPDATE gateway_commands SET status = 'running' WHERE id = ANY(${ids})`
  }

  return Response.json({ commands: pending })
}
