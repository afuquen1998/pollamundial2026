// Proceso siempre activo para Easypanel: dispara refresh.js cada día según CRON.
// Default: 9:00 America/Bogota. Cada corrida es un proceso hijo aislado.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const cron = require('node-cron');
const { spawn } = require('child_process');
const path = require('path');

const SCHEDULE = process.env.CRON_SCHEDULE || '0 9 * * *';
const TIMEZONE = process.env.CRON_TZ || 'America/Bogota';

function runRefresh() {
  console.log(`[scheduler] ${new Date().toISOString()} → ejecutando refresh...`);
  const p = spawn(process.execPath, [path.join(__dirname, 'refresh.js')], { stdio: 'inherit' });
  p.on('exit', (code) => console.log(`[scheduler] refresh terminó (código ${code})`));
}

if (!cron.validate(SCHEDULE)) {
  console.error(`[scheduler] CRON_SCHEDULE inválido: "${SCHEDULE}"`);
  process.exit(1);
}

console.log(`[scheduler] activo. Programado "${SCHEDULE}" (${TIMEZONE}). Esperando la hora...`);
cron.schedule(SCHEDULE, runRefresh, { timezone: TIMEZONE });

// Útil para verificar al desplegar: poner RUN_ON_START=true dispara un run al arrancar.
if (process.env.RUN_ON_START === 'true') {
  console.log('[scheduler] RUN_ON_START=true → corriendo una vez ahora.');
  runRefresh();
}
