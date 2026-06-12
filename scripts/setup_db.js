// Crea la tabla `predicciones` ejecutando sql/create_table.sql contra Postgres directo.
// Requiere SUPABASE_DB_URL en .env. Si no la tienes, pega el SQL en el SQL Editor del dashboard.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error('No hay SUPABASE_DB_URL en .env.');
    console.error('Plan B: abre el SQL Editor de Supabase y ejecuta sql/create_table.sql a mano.');
    process.exit(1);
  }
  const { Client } = require('pg');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'create_table.sql'), 'utf8');
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(sql);
    const r = await client.query("select count(*)::int as n from predicciones");
    console.log(`Tabla predicciones OK. Filas actuales: ${r.rows[0].n}`);
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error('setup_db falló:', e.message); process.exit(1); });
