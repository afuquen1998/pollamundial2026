// Ejecuta un archivo .sql contra Postgres (Supabase) usando SUPABASE_DB_URL.
// Uso: node scripts/migrate.js sql/add_platform_scoring.sql
// Si no hay SUPABASE_DB_URL, pega el SQL en el SQL Editor del dashboard.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

async function main() {
  const file = process.argv[2];
  if (!file) { console.error('Uso: node scripts/migrate.js <archivo.sql>'); process.exit(1); }
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error('No hay SUPABASE_DB_URL en .env. Plan B: pega el SQL en el SQL Editor de Supabase.');
    process.exit(1);
  }
  const { Client } = require('pg');
  const sql = fs.readFileSync(path.isAbsolute(file) ? file : path.join(__dirname, '..', file), 'utf8');
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(sql);
    console.log(`OK: ${file} aplicado.`);
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error('migrate falló:', e.message); process.exit(1); });
