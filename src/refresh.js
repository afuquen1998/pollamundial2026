// Cerebro del asistente. Flujo:
//   1. Auto-cierra partidos cuyo kickoff ya pasó (cerrado=true).
//   2. Lee partidos con kickoff en la ventana (default 36h) y cerrado=false.
//   3. Pide al LLM (gpt-5 + web_search) GOLES ESPERADOS por equipo, N muestras (ensemble).
//   4. Promedia las muestras → lambdas estables (mata la varianza entre corridas).
//   5. Motor DETERMINISTA (scoring.js) calcula marcador conservador, arriesgado, top-3 y 1X2.
//   6. Histéresis: solo recomienda CAMBIAR si el conservador supera al pronóstico actual
//      por >= MARGIN puntos de EV y los datos no son de baja confianza. Si no → MANTENER.
//   7. Mensaje de WhatsApp con: tu marcador actual, conservador, arriesgado, panorama y
//      una recomendación clara MANTENER/CAMBIAR. Tú decides.
//   Real: envía por Evolution + guarda. Dry-run: solo imprime.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { select, update } = require('./lib/supabase');
const { respond, extractJsonArray } = require('./lib/openai');
const { SYSTEM, buildUser } = require('./lib/prompt');
const { sendText } = require('./lib/evolution');
const { analyze, evOf } = require('./lib/scoring');
const { AYUDA } = require('./lib/parser');

const DRY = process.argv.includes('--dry-run');
// Si WINDOW_HOURS está seteado, se usa esa ventana fija (modo viejo, para pruebas).
// Si no, la ventana es "hasta el fin del día de hoy en Bogotá" (solo partidos de HOY).
const WINDOW_HOURS = process.env.WINDOW_HOURS ? Number(process.env.WINDOW_HOURS) : null;
const ENSEMBLE = Math.max(1, Number(process.env.ENSEMBLE_SAMPLES || 1)); // muestras a promediar
const MARGIN = Number(process.env.CHANGE_MARGIN || 0.5); // EV mínimo para sugerir cambio
const EFFORT = process.env.REASONING_EFFORT || 'low'; // low = estable y sin agotar tokens
const SAMPLE_GAP_MS = Number(process.env.SAMPLE_GAP_MS || 8000); // espaciar llamadas (evita 429 TPM)
const TZ = 'America/Bogota';

const log = (...a) => console.log(`[refresh${DRY ? ':dry' : ''}]`, ...a);
const fechaHoy = () =>
  new Intl.DateTimeFormat('es-CO', { timeZone: TZ, dateStyle: 'full' }).format(new Date());
// 23:59:59 de hoy en Bogotá (UTC-5 fijo, sin horario de verano).
function finDelDiaBogota(ahora = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(ahora); // 'YYYY-MM-DD'
  return new Date(`${f}T23:59:59-05:00`);
}
const pct = (v) => `${Math.round(v * 100)}%`;
const cleanReason = (s = '') =>
  s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1').replace(/\s{2,}/g, ' ').trim();

// ── LLM: 1 muestra (estimaciones) con 1 reintento de parseo ────
async function unaMuestra(user) {
  for (let intento = 1; intento <= 2; intento++) {
    const { text, searches } = await respond({ system: SYSTEM, input: user, effort: EFFORT });
    log(`  muestra: ${searches} búsquedas, ${text.length} chars`);
    try {
      const arr = extractJsonArray(text);
      if (!Array.isArray(arr) || !arr.length) throw new Error('array vacío');
      return arr;
    } catch (e) {
      log(`  parseo falló (${e.message})${intento === 1 ? ' → reintento' : ''}`);
      if (intento === 2) throw new Error(`JSON inválido tras 2 intentos: ${e.message}`);
    }
  }
}

// ── Ensemble: promedia lambdas de N muestras por partido ───────
function mergeMuestras(samples, ids) {
  const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
  const out = {};
  for (const id of ids) {
    const items = samples.map((s) => s.find((o) => o && o.id === id)).filter(Boolean);
    if (!items.length) continue;
    const lhs = items.map((i) => num(i.lh)).filter((v) => v != null && v >= 0);
    const las = items.map((i) => num(i.la)).filter((v) => v != null && v >= 0);
    if (!lhs.length || !las.length) continue;
    const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const lh = Math.max(0.15, avg(lhs)); // evita lambda 0 (Poisson degenerado)
    const la = Math.max(0.15, avg(las));
    // confianza: la más cautelosa entre muestras
    const order = { Alta: 3, Media: 2, Baja: 1 };
    const conf = items
      .map((i) => i.conf)
      .filter((c) => order[c])
      .sort((a, b) => order[a] - order[b])[0] || 'Media';
    const trascendente = items.every((i) => i.trascendente !== false);
    const facts = (items.map((i) => i.facts).find((f) => f && f.trim()) || '').trim();
    // odds 1X2 implícitas: promedia las muestras que las traen (verificación cruzada de λ)
    const oddsItems = items
      .map((i) => i.odds)
      .filter((o) => o && num(o['1']) != null && num(o['2']) != null);
    let odds = null;
    if (oddsItems.length) {
      const m = (k) => avg(oddsItems.map((o) => num(o[k]) || 0));
      const o = { '1': m('1'), X: m('X'), '2': m('2') };
      const s = o['1'] + o.X + o['2'];
      odds = s > 0 ? { '1': o['1'] / s, X: o.X / s, '2': o['2'] / s } : null;
    }
    out[id] = { id, lh, la, conf, trascendente, facts, odds, muestras: items.length };
  }
  return out;
}

async function estimar(rows) {
  const user = buildUser(rows, fechaHoy());
  const samples = [];
  for (let s = 1; s <= ENSEMBLE; s++) {
    if (s > 1 && SAMPLE_GAP_MS) await new Promise((r) => setTimeout(r, SAMPLE_GAP_MS));
    log(`ensemble ${s}/${ENSEMBLE}...`);
    samples.push(await unaMuestra(user));
  }
  return mergeMuestras(samples, rows.map((r) => r.id));
}

// Verificación cruzada: si las cuotas (mercado) contradicen el favorito que implican
// las λ del modelo, el modelo invirtió local/visitante → confiamos en el mercado y
// corregimos las λ. Atrapa errores como "cito Brasil 54% pero estimo a Marruecos favorito".
function reconciliarConOdds(est) {
  let { lh, la } = est;
  const o = est.odds;
  if (o && Math.abs(o['1'] - o['2']) > 0.08 && Math.abs(lh - la) > 0.1) {
    const oddsFavLocal = o['1'] > o['2'];
    const lamFavLocal = lh > la;
    if (oddsFavLocal !== lamFavLocal) {
      log(`  ${est.id}: λ contradice mercado → corrijo (swap ${lh}-${la} → ${la}-${lh})`);
      [lh, la] = [la, lh];
      return { lh, la, conf: est.conf === 'Alta' ? 'Media' : est.conf };
    }
  }
  return { lh, la, conf: est.conf };
}

// ── Construye el bloque del partido + decide MANTENER/CAMBIAR ───
function analizarPartido(p, est0) {
  const fix = reconciliarConOdds(est0);
  const est = { ...est0, lh: fix.lh, la: fix.la, conf: fix.conf };
  const an = analyze(est.lh, est.la);
  const curEv = evOf(est.lh, est.la, p.c_h, p.c_a); // EV del pronóstico ya cargado
  const gain = an.conservative.ev - curEv;
  const sameAsCurrent = an.conservative.h === p.c_h && an.conservative.a === p.c_a;
  const cambiar = !sameAsCurrent && gain >= MARGIN && est.conf !== 'Baja';
  return { p, est, an, curEv, gain, cambiar };
}

function lineaPartido(d) {
  const { p, est, an, gain, cambiar } = d;
  const c = an.conservative, a = an.aggressive;
  const rotacion = est.trascendente
    ? ''
    : '\n⚠️ Ojo: hay un equipo ya clasificado o eliminado, podría rotar jugadores.';
  const top = an.top3.map((t) => `${t.h}-${t.a}`).join(' · ');
  const reco = cambiar
    ? `👉 *CAMBIA a ${c.h}-${c.a}*  (ganarías ~${gain.toFixed(1)} pts más que con tu ${p.c_h}-${p.c_a})`
    : `👉 *DEJA tu ${p.c_h}-${p.c_a}*  (ya es casi lo mejor, no vale la pena cambiar)`;
  return (
    `━━━━━━━━━━━━━━\n` +
    `⚽ *[${p.id}] ${p.home} vs ${p.away}*   · confianza en los datos: ${est.conf}${rotacion}\n\n` +
    `📌 Tu marcador cargado: ${p.c_h}-${p.c_a}\n` +
    `🛡️ Opción SEGURA: ${c.h}-${c.a}   (≈${c.ev.toFixed(1)} pts en promedio)\n` +
    `🔥 Opción ARRIESGADA: ${a.h}-${a.a}   (${pct(a.pExact)} de pegarla clavada → 10 pts)\n\n` +
    `📊 ¿Quién gana?  ${p.home} ${pct(an.probs['1'])} · Empate ${pct(an.probs['X'])} · ${p.away} ${pct(an.probs['2'])}\n` +
    `🎯 Marcadores más probables: ${top}\n` +
    (est.facts ? `🧠 Dato clave: ${cleanReason(est.facts)}\n` : '') +
    `\n${reco}`
  );
}

function buildMensaje(analizados) {
  const total = analizados.length;
  const nCambios = analizados.filter((d) => d.cambiar).length;
  const cuerpo = analizados.map(lineaPartido).join('\n');
  const leyenda =
    `\n━━━━━━━━━━━━━━\n` +
    `ℹ️ *Cómo leer esto:*\n` +
    `🛡️ *SEGURA* = el marcador que en promedio te da más puntos. La apuesta sólida y estable.\n` +
    `🔥 *ARRIESGADA* = el marcador con más chance de acertar EXACTO (vale 10 pts), pero menos probable.\n` +
    `📊 Los % = qué tan probable es cada cosa.\n` +
    `"pts en promedio" sirve solo para comparar: mientras más alto, mejor el marcador.\n` +
    `El cálculo es matemático y estable: no te va a cambiar el marcador de un día a otro sin una razón real.`;
  const instructivo = `\n━━━━━━━━━━━━━━\n${AYUDA}`;
  const texto =
    `🔔 *Polla Mundial 2026* — partidos de hoy\n\n` +
    `Tienes ${total} partido(s) por confirmar. De ${total}, te sugiero cambiar ${nCambios}.\n` +
    `Para cada uno verás: tu marcador cargado, una opción SEGURA, una ARRIESGADA y el panorama. ` +
    `*La decisión final es tuya.*\n` +
    cuerpo +
    leyenda +
    instructivo;
  return { texto, nCambios };
}

async function main() {
  const ahora = new Date();
  const limite = WINDOW_HOURS
    ? new Date(ahora.getTime() + WINDOW_HOURS * 3600 * 1000)
    : finDelDiaBogota(ahora);

  // 1. auto-cierre de partidos ya iniciados
  const pasados = await select(`select=id&cerrado=eq.false&kickoff=lte.${ahora.toISOString()}`);
  if (pasados.length) {
    log(`auto-cerrando ${pasados.length} ya iniciados: ${pasados.map((p) => p.id).join(',')}`);
    if (!DRY) for (const p of pasados) await update(p.id, { cerrado: true });
  }

  // 2. ventana
  const rowsRaw = await select(
    `select=*&cerrado=eq.false&kickoff=gt.${ahora.toISOString()}&kickoff=lte.${limite.toISOString()}&order=kickoff`
  );
  // Guardia: ignora partidos de eliminatorias cuyos equipos aún no se definen
  // ("Por definir") → no tiene sentido analizar hasta saber quién juega.
  const esPlaceholder = (s = '') => /por definir|to be announced|tbd/i.test(s);
  const rows = rowsRaw.filter((r) => !esPlaceholder(r.home) && !esPlaceholder(r.away));
  const saltados = rowsRaw.length - rows.length;
  const etiquetaVentana = WINDOW_HOURS ? `${WINDOW_HOURS}h` : 'hoy';
  log(`ventana ${etiquetaVentana}: ${rows.length} partidos → ${rows.map((r) => r.id).join(',') || '(ninguno)'}` +
    (saltados ? ` | ${saltados} con equipos por definir (ignorados)` : ''));
  if (!rows.length) { log('nada que analizar. Fin.'); return; }

  // 3-5. estimaciones (ensemble) + motor determinista
  let estimaciones;
  try {
    estimaciones = await estimar(rows);
    if (!Object.keys(estimaciones).length) throw new Error('ninguna estimación válida');
  } catch (e) {
    log('ERROR cerebro:', e.message);
    const aviso = `⚠️ *Polla Mundial 2026*\nNo pude analizar los ${rows.length} partidos que se cierran pronto (${e.message}). Revisa manual:\n` +
      rows.map((r) => `• ${r.home} vs ${r.away}`).join('\n');
    if (DRY) { log('MENSAJE (dry):\n' + aviso); return; }
    await sendText(aviso);
    log('enviado aviso de revisar manual.');
    return;
  }

  const analizados = rows.filter((p) => estimaciones[p.id]).map((p) => analizarPartido(p, estimaciones[p.id]));
  const { texto, nCambios } = buildMensaje(analizados);
  log(`analizados: ${analizados.length} | sugerencias de cambio: ${nCambios}`);

  // 6-7. enviar + guardar
  if (DRY) {
    console.log('\n────────── MENSAJE WHATSAPP (dry-run, NO enviado) ──────────');
    console.log(texto);
    console.log('────────────────────────────────────────────────────────────\n');
    return;
  }

  await sendText(texto);
  log('WhatsApp enviado.');

  const nowIso = new Date().toISOString();
  for (const d of analizados) {
    await update(d.p.id, {
      sug_c_h: d.an.conservative.h, sug_c_a: d.an.conservative.a,
      sug_a_h: d.an.aggressive.h, sug_a_a: d.an.aggressive.a,
      sug_conf: d.est.conf, sug_reason: d.est.facts, sug_at: nowIso,
    });
  }
  log(`sugerencias guardadas (${analizados.length}).`);
}

main().catch((e) => { console.error('[refresh] fatal:', e.message); process.exit(1); });
