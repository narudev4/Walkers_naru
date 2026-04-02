import { sql } from '../../../lib/db'
import { authenticate, unauthorized } from '../../../lib/auth'

export async function POST(request) {
  const auth = authenticate(request)
  if (!auth.ok) return unauthorized(auth.error, auth.status)

  try {
    const db = sql()
    // Add skills JSONB column to machines table if not exists
    await db`ALTER TABLE machines ADD COLUMN IF NOT EXISTS skills JSONB DEFAULT '[]'`
    return Response.json({ ok: true, message: 'Migration completed: added skills column' })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
