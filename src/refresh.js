// Cerebro del asistente. Flujo:
//   1. Auto-cierra partidos cuyo kickoff ya pasó (cerrado=true).
//   2. Lee partidos con kickoff en la ventana (default 36h) y cerrado=false.
//   3. Arma el prompt del brief y llama a OpenAI (gpt-5 + web_search).
//   4. Parsea el JSON (limpia ```json, reintenta 1 vez).
//   5. Diff contra la predicción actual → marca cambios.
//   6. Construye el mensaje de WhatsApp.
//   7. Real: envía por Evolution + guarda la sugerencia. Dry-run: solo imprime.
//   Si OpenAI no devuelve JSON válido tras el reintento → WhatsApp de "revisar manual".
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { select, update } = require('./lib/supabase');
const { respond, extractJsonArray } = require('./lib/openai');
const { SYSTEM, buildUser } = require('./lib/prompt');
const { sendText } = require('./lib/evolution');

const DRY = process.argv.includes('--dry-run');
const WINDOW_HOURS = Number(process.env.WINDOW_HOURS || 36);
const TZ = 'America/Bogota';

const log = (...a) => console.log(`[refresh${DRY ? ':dry' : ''}]`, ...a);
const fechaHoy = () =>
  new Intl.DateTimeFormat('es-CO', { timeZone: TZ, dateStyle: 'full' }).format(new Date());

// WhatsApp no renderiza markdown: [texto](url) → texto. Quita params utm.
const cleanReason = (s = '') =>
  s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1').replace(/\s{2,}/g, ' ').trim();

// ── línea por partido para el mensaje ──────────────────────────
const linea = (r, byId) => {
  const p = byId[r.id];
  return `⚽ ${p.home} vs ${p.away}  (${r.conf})\n` +
    `   🛡️ Conservadora: ${r.c[0]}-${r.c[1]}\n` +
    `   🔥 Agresiva: ${r.a[0]}-${r.a[1]}\n` +
    `   ➤ ${cleanReason(r.reason)}`;
};

function buildMensaje(recs, byId) {
  const cambios = recs.filter((r) => {
    const p = byId[r.id];
    if (!p) return false;
    const dC = r.c[0] !== p.c_h || r.c[1] !== p.c_a;
    const dA = r.a[0] !== p.a_h || r.a[1] !== p.a_a;
    return dC || dA;
  });
  const total = recs.length;
  const texto = cambios.length
    ? `🔔 *Polla Mundial 2026* — cierre próximo\n\n` +
      `Se cierran ${total} partidos pronto. Cambios sugeridos: ${cambios.length}\n\n` +
      cambios.map((r) => linea(r, byId)).join('\n\n') +
      `\n\n_Tú decides y lo cargas manual._`
    : `✅ *Polla Mundial 2026*\nSe cierran ${total} partidos pronto y NO hay cambios sugeridos. Carga tus pronósticos actuales.`;
  return { texto, cambios };
}

// ── llamada a OpenAI con 1 reintento de parseo ─────────────────
async function pedirRecomendaciones(rows) {
  const user = buildUser(rows, fechaHoy());
  for (let intento = 1; intento <= 2; intento++) {
    const { text, searches } = await respond({ system: SYSTEM, input: user });
    log(`OpenAI intento ${intento}: ${searches} búsquedas web, ${text.length} chars`);
    try {
      const arr = extractJsonArray(text);
      if (!Array.isArray(arr) || !arr.length) throw new Error('array vacío');
      return arr;
    } catch (e) {
      log(`parseo falló (${e.message})${intento === 1 ? ' → reintento' : ''}`);
      if (intento === 2) throw new Error(`JSON inválido tras 2 intentos: ${e.message}`);
    }
  }
}

async function main() {
  const ahora = new Date();
  const limite = new Date(ahora.getTime() + WINDOW_HOURS * 3600 * 1000);

  // 1. auto-cierre de partidos ya iniciados
  const pasados = await select(`select=id&cerrado=eq.false&kickoff=lte.${ahora.toISOString()}`);
  if (pasados.length) {
    log(`auto-cerrando ${pasados.length} partidos ya iniciados: ${pasados.map((p) => p.id).join(',')}`);
    if (!DRY) for (const p of pasados) await update(p.id, { cerrado: true });
  }

  // 2. ventana: kickoff entre ahora y +36h, no cerrados
  const rows = await select(
    `select=*&cerrado=eq.false&kickoff=gt.${ahora.toISOString()}&kickoff=lte.${limite.toISOString()}&order=kickoff`
  );
  log(`ventana ${WINDOW_HOURS}h: ${rows.length} partidos → ${rows.map((r) => r.id).join(',') || '(ninguno)'}`);

  if (!rows.length) {
    log('nada se cierra pronto. Fin sin molestar.');
    return;
  }

  const byId = Object.fromEntries(rows.map((p) => [p.id, p]));

  // 3-5. OpenAI + diff
  let recs;
  try {
    recs = await pedirRecomendaciones(rows);
  } catch (e) {
    log('ERROR cerebro:', e.message);
    const aviso = `⚠️ *Polla Mundial 2026*\nNo pude analizar los ${rows.length} partidos que se cierran pronto (${e.message}). Revisa manual:\n` +
      rows.map((r) => `• ${r.home} vs ${r.away}`).join('\n');
    if (DRY) { log('MENSAJE (dry):\n' + aviso); return; }
    await sendText(aviso);
    log('enviado aviso de revisar manual.');
    return;
  }

  const { texto, cambios } = buildMensaje(recs, byId);
  log(`recomendaciones: ${recs.length} | cambios sugeridos: ${cambios.length}`);

  // 6-7. enviar + guardar sugerencia
  if (DRY) {
    console.log('\n────────── MENSAJE WHATSAPP (dry-run, NO enviado) ──────────');
    console.log(texto);
    console.log('────────────────────────────────────────────────────────────\n');
    return;
  }

  await sendText(texto);
  log('WhatsApp enviado.');

  const nowIso = new Date().toISOString();
  for (const r of recs) {
    if (!byId[r.id]) continue;
    await update(r.id, {
      sug_c_h: r.c[0], sug_c_a: r.c[1], sug_a_h: r.a[0], sug_a_a: r.a[1],
      sug_conf: r.conf, sug_reason: r.reason, sug_at: nowIso,
    });
  }
  log(`sugerencias guardadas (${recs.length}).`);
}

main().catch((e) => { console.error('[refresh] fatal:', e.message); process.exit(1); });
