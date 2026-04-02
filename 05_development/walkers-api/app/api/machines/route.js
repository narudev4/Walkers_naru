import { sql } from '../../../lib/db'
import { authenticate, unauthorized } from '../../../lib/auth'
export { OPTIONS } from '../../../lib/cors'

// sub_agentsカラムが存在しない場合に追加するマイグレーション
let _subAgentsColumnReady = false
async function ensureSubAgentsColumn(db) {
  if (_subAgentsColumnReady) return
  try {
    await db`ALTER TABLE machines ADD COLUMN IF NOT EXISTS sub_agents JSONB DEFAULT '[]'`
    _subAgentsColumnReady = true
  } catch { _subAgentsColumnReady = true /* ignore if already exists */ }
}

export async function GET(request) {
  const auth = authenticate(request)
  if (!auth.ok) return unauthorized(auth.error, auth.status)

  // X-Machine-Idヘッダーでアクセス権フィルタ
  const myMachineId = request.headers.get('X-Machine-Id') || ''

  const db = sql()
  await ensureSubAgentsColumn(db)

  let rows
  if (myMachineId) {
    // 共有マシンのみ表示 + アクセス権フィルタ
    // access_scope='all' OR myMachineId in allowed_machines OR machine_id=myMachineId (自分自身は常に表示)
    rows = await db`
      SELECT *,
        CASE WHEN last_heartbeat > NOW() - INTERVAL '5 minutes' THEN true ELSE false END AS is_online
      FROM machines
      WHERE access_scope = 'all'
         OR ${myMachineId} = ANY(allowed_machines)
         OR machine_id = ${myMachineId}
      ORDER BY created_at DESC
    `
  } else {
    // Machine-Idなし = access_scope='all'のみ返す
    rows = await db`
      SELECT *,
        CASE WHEN last_heartbeat > NOW() - INTERVAL '5 minutes' THEN true ELSE false END AS is_online
      FROM machines
      WHERE access_scope = 'all'
      ORDER BY created_at DESC
    `
  }
  return Response.json({ machines: rows })
}

export async function POST(request) {
  const auth = authenticate(request)
  if (!auth.ok) return unauthorized(auth.error, auth.status)

  try {
    const body = await request.json()
    const { machine_id, machine_name, description, host, port, access_scope, allowed_machines, skills, sub_agents } = body

    if (!machine_id || !machine_name) {
      return Response.json({ error: 'machine_id and machine_name are required' }, { status: 400 })
    }

    const db = sql()
    await ensureSubAgentsColumn(db)

    const rows = await db`
      INSERT INTO machines (machine_id, machine_name, description, host, port, access_scope, allowed_machines, skills, sub_agents, is_online, last_heartbeat)
      VALUES (${machine_id}, ${machine_name}, ${description || null},
              ${host || null}, ${port || 8080}, ${access_scope || 'select'},
              ${allowed_machines || []}, ${JSON.stringify(skills || [])},
              ${JSON.stringify(sub_agents || [])}, true, NOW())
      ON CONFLICT (machine_id) DO UPDATE SET
        machine_name = EXCLUDED.machine_name, description = EXCLUDED.description,
        host = EXCLUDED.host, port = EXCLUDED.port,
        access_scope = EXCLUDED.access_scope, allowed_machines = EXCLUDED.allowed_machines,
        skills = EXCLUDED.skills, sub_agents = EXCLUDED.sub_agents,
        is_online = true, last_heartbeat = NOW(), updated_at = NOW()
      RETURNING *
    `
    return Response.json(rows[0], { status: 201 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
