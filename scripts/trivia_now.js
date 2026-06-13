// Envío SUPERVISADO de la trivia (A0+A2) y poller manual.
// Uso: node scripts/trivia_now.js
//   - Si NO hay pregunta activa → lo informa y sale (sin daño).
//   - Si HAY pregunta → flujo ATÓMICO: el GET ya arrancó los 20s, así que resuelve
//     con la IA y ENVÍA en el acto. Imprime todo para supervisión y guarda el HTML
//     crudo (trivia_capturas/) para verificar/ajustar el parser.
//   - Fallback: si la IA falla o tarda, envía igual la 1ª opción (25% > 0%).
//
// ⚠️ Correr SOLO cuando se quiera comprometer el intento del día (la primera vista
// quema la pregunta). Si no hay pregunta, es seguro correrlo cuantas veces se quiera.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const trivia = require('../src/lib/publishers/trivia');
const solver = require('../src/lib/triviaSolver');
const { rest } = require('../src/lib/supabase');

const log = (...a) => console.log('[trivia]', ...a);
const fechaIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

async function yaRespondida(cod) {
  if (!cod) return false;
  try {
    const r = await rest(`trivia_log?select=cod&cod=eq.${encodeURIComponent(cod)}`);
    return Array.isArray(r) && r.length > 0;
  } catch { return false; }
}

async function registrar(fila) {
  try {
    await rest('trivia_log?on_conflict=cod', {
      method: 'POST', body: [fila],
      headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
    });
  } catch (e) { log('no se pudo registrar en trivia_log:', e.message); }
}

(async () => {
  const jar = trivia.createJar();
  await trivia.login(jar);
  log('login OK. Consultando trivia.asp... (⚠️ esto arranca el reloj si hay pregunta)');

  const t0 = Date.now();
  const preg = await trivia.hayPregunta(jar);
  if (!preg) { log('No hay pregunta activa ahora. Nada que hacer (sin daño).'); return; }

  // guardar HTML crudo para post-mortem del parser
  try {
    const dir = path.join(__dirname, '..', 'trivia_capturas');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${fechaIso()}_${Date.now()}.html`), preg.html);
  } catch {}

  log(`PREGUNTA: ${preg.pregunta}`);
  preg.opciones.forEach((o, i) => log(`  ${i + 1}) [id=${o.id}] ${o.texto}`));
  log(`sec=${preg.sec} cod=${preg.cod} segundos=${preg.segundos}`);

  if (await yaRespondida(preg.cod)) { log(`Ya respondí la pregunta cod=${preg.cod} antes. No reenvío.`); return; }

  // Resolver con IA; si falla/tarda → fallback a la 1ª opción.
  let idRespuesta, indice, razon, fuente;
  try {
    const margen = Math.max(4000, 16000 - (Date.now() - t0)); // deja ~4s para el envío
    const r = await solver.solve(preg.pregunta, preg.opciones, { timeoutMs: margen });
    ({ idRespuesta, indice, razon } = r); fuente = `IA (${(r.ms / 1000).toFixed(1)}s)`;
  } catch (e) {
    idRespuesta = preg.opciones[0].id; indice = 0; razon = `fallback (${e.message})`; fuente = 'FALLBACK';
    log('⚠️ solver falló → fallback a opción 1:', e.message);
  }

  const tRestante = Math.max(1, preg.segundos - Math.round((Date.now() - t0) / 1000));
  log(`Enviando opción ${indice + 1} [id=${idRespuesta}] (${fuente}) con t=${tRestante}...`);
  const res = await trivia.responder(jar, { sec: preg.sec, cod: preg.cod, idRespuesta, t: tRestante });

  log(`RESULTADO: ok=${res.ok} acierto=${res.acierto}`);
  log(`respuesta servidor: ${res.texto}`);

  await registrar({
    cod: String(preg.cod), sec: String(preg.sec || ''), fecha: fechaIso(),
    pregunta: preg.pregunta.slice(0, 500), id_respuesta: String(idRespuesta), acierto: res.acierto,
  });
  log('registrado en trivia_log.');
})().catch((e) => { console.error('[trivia] FATAL', e.message); process.exit(1); });
