// Cliente mínimo de Supabase REST (PostgREST) con la service_role key. Sin SDK.
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const BASE = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY;

function assertEnv() {
  if (!BASE || !KEY) throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_KEY en .env');
}

async function rest(pathAndQuery, { method = 'GET', body, headers = {} } = {}) {
  assertEnv();
  const res = await fetch(`${BASE}/rest/v1/${pathAndQuery}`, {
    method,
    headers: {
      apikey: KEY,
      authorization: `Bearer ${KEY}`,
      'content-type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${method} ${pathAndQuery} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const select = (query) => rest(`predicciones?${query}`);

const upsert = (rows) =>
  rest('predicciones?on_conflict=id', {
    method: 'POST',
    body: rows,
    headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
  });

const update = (id, patch) =>
  rest(`predicciones?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: patch,
    headers: { prefer: 'return=minimal' },
  });

module.exports = { rest, select, upsert, update };
