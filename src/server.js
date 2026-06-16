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
const { intentarResponder, mensajeResultado } = require('./lib/triviaFlow');

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

// ── Cron de TRIVIA (Iniciativa A) — DESACTIVADO por defecto ────────────────
// Solo se activa con TRIVIA_ENABLED=true (tras verificar el primer envío supervisado).
// Sondea unas pocas veces al día durante la ventana del concurso; al detectar una
// pregunta nueva resuelve y responde en el acto (flujo atómico, fallback siempre envía).
const TRIVIA_ENABLED = process.env.TRIVIA_ENABLED === 'true';
// Sondeo frecuente: la pregunta puede aparecer a cualquier hora del día; cada 15 min
// (6am–11pm Bogotá) la detecta y responde en minutos, sin depender del usuario.
const TRIVIA_SCHEDULE = process.env.TRIVIA_SCHEDULE || '*/10 6-23 * * *';
const CONCURSO_INI = '2026-06-11';
const CONCURSO_FIN = '2026-07-19';

function fechaBogota(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function enVentanaConcurso(d = new Date()) {
  const f = fechaBogota(d);
  return f >= CONCURSO_INI && f <= CONCURSO_FIN;
}

let avisoSinSaldoFecha = ''; // para no repetir el aviso de "sin saldo" muchas veces al día

// Hora ALEATORIA de respuesta (rompe el patrón "siempre a la misma hora") sin perder
// velocidad: solo cambia A QUÉ HORA del día responde, no qué tan rápido (los 20s siguen
// al máximo). Cada día elige un minuto objetivo aleatorio (determinístico por fecha) en
// la ventana [TRIVIA_HORA_INI, TRIVIA_HORA_FIN] (def 06:00–08:50). Antes de esa hora no
// responde; a partir de ahí responde en el primer sondeo con pregunta disponible. Si la
// pregunta no apareció aún a esa hora, sigue intentando el resto del día (no la pierde).
const TRIVIA_HORA_ALEATORIA = (process.env.TRIVIA_HORA_ALEATORIA || 'true') === 'true';
const hhmmAMin = (s, def) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : def; };
const TRIVIA_INI_MIN = hhmmAMin(process.env.TRIVIA_HORA_INI, 6 * 60);      // 06:00
const TRIVIA_FIN_MIN = hhmmAMin(process.env.TRIVIA_HORA_FIN, 8 * 60 + 40); // 08:40 (con sondeo */10 → responde a más tardar 8:40, siempre antes de las 9)

function minutoBogota(d = new Date()) {
  const s = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}
// Minuto objetivo de hoy: aleatorio pero estable durante todo el día (semilla = fecha).
function minutoObjetivoHoy() {
  const ini = Math.min(TRIVIA_INI_MIN, TRIVIA_FIN_MIN), fin = Math.max(TRIVIA_INI_MIN, TRIVIA_FIN_MIN);
  let h = 2166136261;
  for (const c of fechaBogota()) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return ini + (h % (fin - ini + 1));
}

async function sondearTrivia() {
  if (!enVentanaConcurso()) { console.log('[trivia] fuera de la ventana del concurso, omito.'); return; }
  if (TRIVIA_HORA_ALEATORIA) {
    const obj = minutoObjetivoHoy(), ahora = minutoBogota();
    if (ahora < obj) {
      console.log(`[trivia] aún no es la hora objetivo de hoy (${Math.floor(obj / 60)}:${String(obj % 60).padStart(2, '0')}); ahora ${Math.floor(ahora / 60)}:${String(ahora % 60).padStart(2, '0')}. Espero.`);
      return;
    }
  }
  try {
    const rep = await intentarResponder({ log: (...a) => console.log('[trivia]', ...a) });
    console.log('[trivia] estado:', rep.estado);
    if (rep.estado === 'respondida') {
      const msg = mensajeResultado(rep);
      if (msg) await sendText(msg);
    } else if (rep.estado === 'sin-saldo') {
      // Hay trivia disponible pero OpenAI no tiene saldo → NO se quemó la pregunta.
      // Avisar 1 vez/día; en cuanto haya saldo, el próximo tick la responde.
      const hoy = fechaBogota();
      if (avisoSinSaldoFecha !== hoy) {
        avisoSinSaldoFecha = hoy;
        await sendText('⚠️ Hay trivia disponible HOY, pero tu OpenAI está *sin saldo*. Recarga en platform.openai.com → Billing y la respondo sola en minutos (no se ha perdido la pregunta).');
      }
    } else if (rep.estado === 'error') {
      await sendText(`⚠️ Trivia: hubo un problema al responder (${rep.error}). Revisa manual si quieres.`);
    }
  } catch (e) {
    console.error('[trivia] sondeo falló:', e.message);
  }
}

if (TRIVIA_ENABLED) {
  if (!cron.validate(TRIVIA_SCHEDULE)) {
    console.error(`[server] TRIVIA_SCHEDULE inválido: "${TRIVIA_SCHEDULE}" → trivia no programada.`);
  } else {
    console.log(`[server] cron TRIVIA activo. Programado "${TRIVIA_SCHEDULE}" (${CRON_TZ}).`);
    cron.schedule(TRIVIA_SCHEDULE, sondearTrivia, { timezone: CRON_TZ });
  }
} else {
  console.log('[server] cron TRIVIA DESACTIVADO (poné TRIVIA_ENABLED=true para activarlo).');
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

// "trivia": dispara el intento de responder la trivia de hoy en el acto (manual / prueba).
async function procesarTrivia() {
  await sendText('⏳ Revisando si hay trivia activa ahora...');
  const rep = await intentarResponder({ log: (...a) => console.log('[trivia]', ...a) });
  if (rep.estado === 'sin-pregunta') { await sendText('ℹ️ No hay pregunta de trivia activa en este momento. Cuando aparezca, la respondo solo.'); return; }
  if (rep.estado === 'ya-respondida') { await sendText('👍 La trivia de hoy ya estaba respondida.'); return; }
  if (rep.estado === 'sin-saldo') { await sendText('⚠️ Hay trivia disponible, pero tu OpenAI está *sin saldo*. Recarga en platform.openai.com → Billing y vuelve a escribir "trivia" (no se perdió la pregunta).'); return; }
  if (rep.estado === 'error') { await sendText(`⚠️ Trivia: hubo un problema (${rep.error}).`); return; }
  const msg = mensajeResultado(rep);
  if (msg) await sendText(msg);
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
  if (cmd.type === 'trivia') {
    await procesarTrivia();
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
