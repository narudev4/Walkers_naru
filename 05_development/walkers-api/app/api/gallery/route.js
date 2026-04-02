import { sql } from '../../../lib/db'
import { authenticate, unauthorized } from '../../../lib/auth'
export { OPTIONS } from '../../../lib/cors'

export async function GET(request) {
  const auth = authenticate(request)
  if (!auth.ok) return unauthorized(auth.error, auth.status)

  const db = sql()
  const rows = await db`SELECT * FROM gallery ORDER BY updated_at DESC`
  return Response.json({ items: rows })
}

export async function POST(request) {
  const auth = authenticate(request)
  if (!auth.ok) return unauthorized(auth.error, auth.status)

  try {
    const body = await request.json()
    const { id, title, description, category, thumbnail, url, tags, metadata } = body

    if (!id || !title) {
      return Response.json({ error: 'id and title are required' }, { status: 400 })
    }

    const db = sql()
    const rows = await db`
      INSERT INTO gallery (id, title, description, category, thumbnail, url, tags, metadata, created_by)
      VALUES (${id}, ${title}, ${description || null}, ${category || null},
              ${thumbnail || null}, ${url || null},
              ${tags || []}, ${JSON.stringify(metadata || {})},
              ${body.created_by || auth.machineId})
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title, description = EXCLUDED.description,
        category = EXCLUDED.category, thumbnail = EXCLUDED.thumbnail,
        url = EXCLUDED.url, tags = EXCLUDED.tags, metadata = EXCLUDED.metadata,
        updated_at = NOW()
      RETURNING *
    `
    return Response.json(rows[0], { status: 201 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
