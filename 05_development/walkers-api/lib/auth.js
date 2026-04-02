export function authenticate(request) {
  const apiKey = request.headers.get('x-api-key')
  const machineId = request.headers.get('x-machine-id')

  if (!apiKey || apiKey !== process.env.WALKERS_API_KEY) {
    return { ok: false, error: 'Invalid API key', status: 401 }
  }
  if (!machineId) {
    return { ok: false, error: 'Missing X-Machine-Id header', status: 400 }
  }
  return { ok: true, machineId }
}

export function unauthorized(msg, status = 401) {
  return Response.json({ error: msg }, { status })
}
