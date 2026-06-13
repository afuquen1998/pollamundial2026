// Proceso único para Easypanel: cron diario (refresh.js) + servidor HTTP
// (health check + webhook de WhatsApp para decisiones de publicación).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cron = require('node-cron');
const { spawn } = require('child_process');
const path = require('path');

const { select } = require('./lib/supabase');
const { sendText } = require('./lib/evolution');
const { parseComando, AYUDA } = require('./lib/parser');
const { publishToTargets } = require('./lib/publishLogic');
const ranking = require('./lib/publishers/ranking');
const postura = require('./lib/postura');

const PORT = Number(process.env.PORT || 3000);
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN;
const MI_NUMERO = (process.env.MI_NUMERO || '').replace(/\D/g, '');
const DEFAULT_TARGET = process.env.PUBLISH_DEFAULT_TARGET || 'ambas';
const DRY_RUN = process.env.PUBLISH_DRY_RUN === 'true';
const TZ = 'America/Bogota';

// ── Cron (lo que antes hacía scheduler.js) ─────────────────────────────────
const SCHEDULE = process.env.CRON_SCHEDULE || '0 9 * * *';
const CRON_TZ = process.env.CRON_TZ || TZ;

function runRefresh() {
  console.log(`[cron] ${new Date().toISOString()} → ejecutando refresh...`);
  const p = spawn(process.execPath, [path.join(__dirname, 'refresh.js')], { stdio: 'inherit' });
  p.on('exit', (code) => console.log(`[cron] refresh terminó (código ${code})`));
}

if (!cron.validate(SCHEDULE)) {
  console.error(`[server] CRON_SCHEDULE inválido: "${SCHEDULE}"`);
  process.exit(1);
}
console.log(`[server] cron activo. Programado "${SCHEDULE}" (${CRON_TZ}).`);
cron.schedule(SCHEDULE, runRefresh, { timezone: CRON_TZ });

if (process.env.RUN_ON_START === 'true') {
  console.log('[server] RUN_ON_START=true → corriendo refresh una vez ahora.');
  runRefresh();
}

// ── Helpers ─────────────────────────────────────────────────────────────
// 23:59:59 de hoy en Bogotá (UTC-5 fijo, sin horario de verano).
function finDelDiaBogota(ahora = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(ahora); // 'YYYY-MM-DD'
  return new Date(`${f}T23:59:59-05:00`);
}

const esPlaceholder = (s = '') => /por definir|to be announced|tbd/i.test(s);

// Muestra el resultado por plataforma con el marcador que recibió CADA polla
// (pueden diferir: PG y PF puntúan distinto).
function lineResultado(id, row, results, targets) {
  const partes = targets.map((t) => {
    const r = results[t];
    const nombre = t === 'futbolera' ? 'Polla Futbolera' : 'Predicción Ganadora';
    const mk = r.gh != null && r.ga != null ? `${r.gh}-${r.ga} ` : '';
    if (r.ok) return `${nombre} ${mk}✓`;
    return `${nombre} ✗ (${r.motivo || 'error'})`;
  });
  const todosOk = targets.every((t) => results[t].ok);
  const cabecera = `[${id}] ${row.home} vs ${row.away}`;
  if (todosOk) return `✅ ${cabecera} → ${partes.join(' · ')}`;
  return `⚠️ ${cabecera} → ${partes.join(' · ')} — intenta de nuevo o hazlo a mano.`;
}

// ── Procesamiento de comandos (en serie, una cola simple) ──────────────────
let queue = Promise.resolve();
function enqueue(fn) {
  queue = queue.then(fn).catch((e) => console.error('[server] error en cola:', e));
  return queue;
}

const SUG_COLS = 'c_h,c_a,c_pf_h,c_pf_a,sug_c_h,sug_c_a,sug_a_h,sug_a_a,sug_pf_c_h,sug_pf_c_a,sug_pf_a_h,sug_pf_a_a';

async function procesarPartido(cmd) {
  const { id, tipo, target } = cmd;
  const rows = await select(`id,home,away,kickoff,${SUG_COLS}&id=eq.${encodeURIComponent(id)}`);
  const row = rows[0];
  if (!row) {
    await sendText(`❓ No encontré el partido [${id}].`);
    return;
  }

  if (tipo === 'mantener') {
    const pg = `${row.c_h ?? '?'}-${row.c_a ?? '?'}`;
    const pf = `${row.c_pf_h ?? '?'}-${row.c_pf_a ?? '?'}`;
    const detalle = pg === pf ? pg : `P.Ganadora ${pg} · Futbolera ${pf}`;
    await sendText(`👍 [${id}] ${row.home} vs ${row.away} se deja como está (${detalle}).`);
    return;
  }

  const dest = target || DEFAULT_TARGET;
  console.log(`[server] publicando ${id} tipo=${tipo} target=${dest}${DRY_RUN ? ' (dry-run)' : ''}`);
  const { results, targets } = await publishToTargets(row, tipo, dest, DRY_RUN);
  await sendText(lineResultado(id, row, results, targets));
}

async function procesarTodos(cmd) {
  const tipo = cmd.tipo; // 'seguro' | 'arriesgado'
  const ahora = new Date();
  const limite = finDelDiaBogota(ahora);
  const rowsRaw = await select(
    `select=id,home,away,kickoff,${SUG_COLS}&cerrado=eq.false` +
      `&kickoff=gt.${ahora.toISOString()}&kickoff=lte.${limite.toISOString()}&order=kickoff`
  );
  const rows = rowsRaw.filter((r) => !esPlaceholder(r.home) && !esPlaceholder(r.away));

  if (!rows.length) {
    await sendText('ℹ️ No hay partidos pendientes de hoy.');
    return;
  }

  await sendText(`⏳ Procesando "${tipo}" para ${rows.length} partido(s) de hoy, espera un momento...`);

  const lineas = [];
  for (const row of rows) {
    try {
      const { results, targets } = await publishToTargets(row, tipo, DEFAULT_TARGET, DRY_RUN);
      lineas.push(lineResultado(row.id, row, results, targets));
    } catch (e) {
      lineas.push(`⚠️ [${row.id}] error: ${e.message}`);
    }
  }

  await sendText(`Resumen "${tipo}":\n${lineas.join('\n')}`);
}

// "postura": lee tu posición en vivo en ambas pollas y sugiere una postura.
async function procesarPostura() {
  await sendText('⏳ Consultando tu posición en ambas pollas...');
  const [pg, pf, restantes] = await Promise.all([
    ranking.posicionesPG().catch((e) => { console.error('[server] ranking PG:', e.message); return null; }),
    ranking.posicionesPF().catch((e) => { console.error('[server] ranking PF:', e.message); return null; }),
    ranking.contarRestantes().catch(() => 0),
  ]);
  if (!pg && !pf) {
    await sendText('⚠️ No pude leer tu posición ahora. Intenta más tarde.');
    return;
  }
  await sendText(postura.bloque([pg, pf], restantes));
}

async function procesarMensaje(texto) {
  const cmd = parseComando(texto);
  if (!cmd) {
    // Texto que no es un comando (chat normal en el mismo número): se ignora en silencio.
    console.log(`[server] webhook: texto no reconocido, ignorado: "${texto}"`);
    return;
  }
  if (cmd.type === 'ayuda') {
    await sendText(AYUDA);
    return;
  }
  if (cmd.type === 'postura') {
    await procesarPostura();
    return;
  }
  if (cmd.type === 'todos') {
    await procesarTodos(cmd);
    return;
  }
  if (cmd.type === 'partido') {
    await procesarPartido(cmd);
    return;
  }
}

// ── Extracción del payload de Evolution (messages.upsert) ──────────────────
function extraerMensajes(body) {
  if (!body || body.event !== 'messages.upsert' || !body.data) return [];
  const datos = Array.isArray(body.data) ? body.data : [body.data];
  return datos
    .map((d) => {
      const remoteJid = d?.key?.remoteJid || '';
      const fromMe = !!d?.key?.fromMe;
      const texto =
        d?.message?.conversation ||
        d?.message?.extendedTextMessage?.text ||
        null;
      return { remoteJid, fromMe, texto };
    })
    .filter((m) => m.texto);
}

// ── Servidor HTTP ───────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => res.status(200).send('ok'));

app.post('/webhook/:token', (req, res) => {
  if (!WEBHOOK_TOKEN || req.params.token !== WEBHOOK_TOKEN) {
    return res.status(404).send('not found');
  }
  // Responder rápido para que Evolution no reintente; procesar en segundo plano.
  res.status(200).send('ok');

  const mensajes = extraerMensajes(req.body);
  for (const m of mensajes) {
    const digits = m.remoteJid.replace(/\D/g, '');
    if (m.fromMe || digits !== MI_NUMERO) continue;
    // Cada línea puede ser un comando independiente (ej. varios códigos en un solo mensaje).
    const lineas = m.texto.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const linea of lineas) {
      console.log(`[server] webhook: "${linea}" de ${digits}`);
      enqueue(() => procesarMensaje(linea));
    }
  }
});

app.listen(PORT, () => console.log(`[server] escuchando en puerto ${PORT}`));
