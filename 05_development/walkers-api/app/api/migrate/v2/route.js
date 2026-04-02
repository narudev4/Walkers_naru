import { sql } from '../../../../lib/db'
import { authenticate, unauthorized } from '../../../../lib/auth'
export { OPTIONS } from '../../../../lib/cors'

export async function POST(request) {
  const auth = authenticate(request)
  if (!auth.ok) return unauthorized(auth.error, auth.status)

  const db = sql()

  // Add prompt field to agents table
  await db`ALTER TABLE agents ADD COLUMN IF NOT EXISTS prompt TEXT DEFAULT ''`

  // Create gateway_commands table for cloud relay
  await db`
    CREATE TABLE IF NOT EXISTS gateway_commands (
      id TEXT PRIMARY KEY,
      machine_id TEXT REFERENCES machines(machine_id) ON DELETE CASCADE,
      prompt TEXT NOT NULL,
      source TEXT DEFAULT 'remote',
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed')),
      result JSONB,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      completed_at TIMESTAMPTZ
    )
  `
  await db`CREATE INDEX IF NOT EXISTS idx_gateway_commands_machine ON gateway_commands(machine_id, status)`
  await db`CREATE INDEX IF NOT EXISTS idx_gateway_commands_created ON gateway_commands(created_at)`

  return Response.json({ ok: true, message: 'Migration v2 complete' })
}
