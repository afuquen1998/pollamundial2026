// Flujo ATÓMICO de respuesta a la trivia, compartido por:
//   - scripts/trivia_now.js (envío supervisado / poller manual)
//   - server.js (cron de sondeo diario, cuando TRIVIA_ENABLED=true)
// Así el primer envío supervisado prueba EXACTAMENTE el mismo código que correrá el cron.
//
// Regla de oro: el GET a /trivia.asp con pregunta activa arranca los 20s y es de un
// solo tiro. Por eso este flujo, al detectar pregunta, resuelve y envía en el acto,
// con fallback que SIEMPRE envía algo (25% > 0%). Registra en trivia_log (1 vez/cod).
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const path = require('path');
const trivia = require('./publishers/trivia');
const solver = require('./triviaSolver');
const { rest } = require('./supabase');

const fechaIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

async function yaRespondida(cod) {
  if (!cod) return false;
  try {
    const r = await rest(`trivia_log?select=cod&cod=eq.${encodeURIComponent(cod)}`);
    return Array.isArray(r) && r.length > 0;
  } catch { return false; }
}

async function registrar(fila) {
  await rest('trivia_log?on_conflict=cod', {
    method: 'POST', body: [fila],
    headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
  });
}

function guardarHtml(html) {
  try {
    const dir = path.join(__dirname, '..', '..', 'trivia_capturas');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${fechaIso()}_${Date.now()}.html`), html);
  } catch { /* no crítico */ }
}

// Detecta y, si hay pregunta nueva, resuelve+envía atómicamente.
// Devuelve un reporte { estado, ... }. `log` opcional para trazas en vivo.
async function intentarResponder({ log = () => {} } = {}) {
  const jar = trivia.createJar();
  await trivia.login(jar);
  log('login OK. Consultando trivia.asp...');

  const t0 = Date.now();
  let preg;
  try {
    preg = await trivia.hayPregunta(jar);
  } catch (e) {
    return { estado: 'error', error: `al leer trivia.asp: ${e.message}` };
  }
  if (!preg) return { estado: 'sin-pregunta' };

  guardarHtml(preg.html);
  log(`PREGUNTA: ${preg.pregunta}`);
  preg.opciones.forEach((o, i) => log(`  ${i + 1}) [id=${o.id}] ${o.texto}`));
  log(`sec=${preg.sec} cod=${preg.cod} segundos=${preg.segundos}`);

  if (await yaRespondida(preg.cod)) return { estado: 'ya-respondida', pregunta: preg.pregunta, cod: preg.cod };

  // Resolver (IA) con fallback a la 1ª opción.
  let idRespuesta, indice, razon, fuente, ms = null;
  try {
    const margen = Math.max(4000, 16000 - (Date.now() - t0)); // deja ~4s para enviar
    const r = await solver.solve(preg.pregunta, preg.opciones, { timeoutMs: margen });
    ({ idRespuesta, indice, razon, ms } = r); fuente = 'IA';
    log(`IA eligió opción ${indice + 1} en ${(ms / 1000).toFixed(1)}s (${razon})`);
  } catch (e) {
    idRespuesta = preg.opciones[0].id; indice = 0; razon = `fallback: ${e.message}`; fuente = 'FALLBACK';
    log('⚠️ solver falló → fallback opción 1:', e.message);
  }

  const tRestante = Math.max(1, preg.segundos - Math.round((Date.now() - t0) / 1000));
  log(`Enviando opción ${indice + 1} [id=${idRespuesta}] (${fuente}) t=${tRestante}...`);
  let resultado;
  try {
    resultado = await trivia.responder(jar, { sec: preg.sec, cod: preg.cod, idRespuesta, t: tRestante });
  } catch (e) {
    return { estado: 'error', error: `al enviar: ${e.message}`, pregunta: preg.pregunta, eleccion: { indice, idRespuesta, razon, fuente } };
  }

  try {
    await registrar({
      cod: String(preg.cod), sec: String(preg.sec || ''), fecha: fechaIso(),
      pregunta: preg.pregunta.slice(0, 500), id_respuesta: String(idRespuesta), acierto: resultado.acierto,
      html: String(preg.html || '').slice(0, 60000), // HTML crudo para depurar el parser
    });
  } catch (e) { log('no se pudo registrar en trivia_log:', e.message); }

  return {
    estado: 'respondida',
    pregunta: preg.pregunta,
    opciones: preg.opciones,
    sec: preg.sec, cod: preg.cod, segundos: preg.segundos,
    eleccion: { indice, idRespuesta, razon, fuente, ms },
    resultado,
  };
}

// Mensaje de WhatsApp resumiendo el resultado (para el cron).
function mensajeResultado(rep) {
  if (rep.estado !== 'respondida') return null;
  const op = rep.opciones[rep.eleccion.indice];
  const icono = rep.resultado.acierto === true ? '✅' : rep.resultado.acierto === false ? '❌' : 'ℹ️';
  const ac = rep.resultado.acierto === true ? 'correcta' : rep.resultado.acierto === false ? 'incorrecta' : 'enviada (resultado no confirmado)';
  return `🧠 *Trivia de hoy* — respuesta ${ac} ${icono}\n` +
    `Pregunta: ${rep.pregunta}\n` +
    `Respondí: ${op ? op.texto : '(opción ' + (rep.eleccion.indice + 1) + ')'}` +
    (rep.eleccion.fuente === 'FALLBACK' ? '  (⚠️ fallback automático)' : '');
}

module.exports = { intentarResponder, mensajeResultado, yaRespondida };
