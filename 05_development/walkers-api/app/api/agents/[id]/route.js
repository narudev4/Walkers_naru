import { sql } from '../../../../lib/db'
import { authenticate, unauthorized } from '../../../../lib/auth'

export async function GET(request, { params }) {
  const auth = authenticate(request)
  if (!auth.ok) return unauthorized(auth.error, auth.status)

  const { id } = await params
  const db = sql()
  const rows = await db`SELECT * FROM agents WHERE id = ${id}`
  if (!rows.length) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json(rows[0])
}

export async function PUT(request, { params }) {
  const auth = authenticate(request)
  if (!auth.ok) return unauthorized(auth.error, auth.status)

  try {
    const { id } = await params
    const body = await request.json()
    const db = sql()

    const existing = await db`SELECT * FROM agents WHERE id = ${id}`
    if (!existing.length) return Response.json({ error: 'Not found' }, { status: 404 })

    const m = { ...existing[0], ...body }
    const rows = await db`
      UPDATE agents SET
        name = ${m.name}, description = ${m.description}, machine_id = ${m.machine_id},
        status = ${m.status || 'stopped'}, skills = ${m.skills || []},
        cron_expression = ${m.cron_expression}, cron_description = ${m.cron_description},
        config = ${JSON.stringify(m.config || {})}, prompt = ${m.prompt || ''}, updated_at = NOW()
      WHERE id = ${id} RETURNING *
    `
    return Response.json(rows[0])
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(request, { params }) {
  const auth = authenticate(request)
  if (!auth.ok) return unauthorized(auth.error, auth.status)

  try {
    const { id } = await params
    const db = sql()
    const rows = await db`DELETE FROM agents WHERE id = ${id} RETURNING id`
    if (!rows.length) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json({ deleted: id })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
