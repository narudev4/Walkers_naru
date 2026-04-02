import { sql } from '../../../lib/db'
import { authenticate, unauthorized } from '../../../lib/auth'
export { OPTIONS } from '../../../lib/cors'

export async function GET(request) {
  const auth = authenticate(request)
  if (!auth.ok) return unauthorized(auth.error, auth.status)

  const db = sql()
  const rows = await db`SELECT * FROM skills ORDER BY created_at DESC`
  return Response.json({ skills: rows })
}

export async function POST(request) {
  const auth = authenticate(request)
  if (!auth.ok) return unauthorized(auth.error, auth.status)

  const body = await request.json()
  const { id, name, description, category, icon, tags, config, content } = body

  if (!id || !name) {
    return Response.json({ error: 'id and name are required' }, { status: 400 })
  }

  try {
    const db = sql()
    const tagsArr = tags || []
    const configObj = config || {}
    const rows = await db`
      INSERT INTO skills (id, name, description, category, icon, tags, config, content, created_by)
      VALUES (${id}, ${name}, ${description || null}, ${category || null},
              ${icon || null}, ${tagsArr}, ${JSON.stringify(configObj)},
              ${content || null},
              ${body.created_by || auth.machineId})
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, description = EXCLUDED.description,
        category = EXCLUDED.category, icon = EXCLUDED.icon,
        tags = EXCLUDED.tags, config = EXCLUDED.config,
        content = EXCLUDED.content, updated_at = NOW()
      RETURNING *
    `
    return Response.json(rows[0], { status: 201 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
