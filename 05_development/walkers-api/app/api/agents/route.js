import { sql } from '../../../lib/db'
import { authenticate, unauthorized } from '../../../lib/auth'

export async function GET(request) {
  const auth = authenticate(request)
  if (!auth.ok) return unauthorized(auth.error, auth.status)

  const { searchParams } = new URL(request.url)
  const machineId = searchParams.get('machine_id')

  const db = sql()
  let rows
  if (machineId) {
    rows = await db`SELECT * FROM agents WHERE machine_id = ${machineId} ORDER BY created_at DESC`
  } else {
    rows = await db`SELECT * FROM agents ORDER BY created_at DESC`
  }
  return Response.json({ agents: rows })
}

export async function POST(request) {
  const auth = authenticate(request)
  if (!auth.ok) return unauthorized(auth.error, auth.status)

  try {
    const body = await request.json()
    const { name, description, machine_id, status, skills, cron_expression, cron_description, config, prompt } = body

    if (!name || !machine_id) {
      return Response.json({ error: 'name and machine_id are required' }, { status: 400 })
    }

    const id = body.id || `${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`

    const db = sql()
    const rows = await db`
      INSERT INTO agents (id, name, description, machine_id, status, skills, cron_expression, cron_description, created_by, config, prompt)
      VALUES (${id}, ${name}, ${description || null}, ${machine_id},
              ${status || 'stopped'}, ${skills || []},
              ${cron_expression || null}, ${cron_description || null},
              ${body.created_by || auth.machineId}, ${JSON.stringify(config || {})}, ${prompt || ''})
      RETURNING *
    `
    return Response.json(rows[0], { status: 201 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
