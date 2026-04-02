import { sql } from '../../../../lib/db'
import { authenticate, unauthorized } from '../../../../lib/auth'
export { OPTIONS } from '../../../../lib/cors'

export async function GET(request, { params }) {
  const auth = authenticate(request)
  if (!auth.ok) return unauthorized(auth.error, auth.status)

  const { id } = await params
  const db = sql()
  const rows = await db`SELECT * FROM gallery WHERE id = ${id}`
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

    const existing = await db`SELECT * FROM gallery WHERE id = ${id}`
    if (!existing.length) return Response.json({ error: 'Not found' }, { status: 404 })

    const m = { ...existing[0], ...body }
    const rows = await db`
      UPDATE gallery SET
        title = ${m.title}, description = ${m.description}, category = ${m.category},
        thumbnail = ${m.thumbnail}, url = ${m.url},
        tags = ${m.tags || []}, metadata = ${JSON.stringify(m.metadata || {})},
        updated_at = NOW()
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
    const rows = await db`DELETE FROM gallery WHERE id = ${id} RETURNING id`
    if (!rows.length) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json({ deleted: id })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
