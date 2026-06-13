// Envío SUPERVISADO de la trivia (A0+A2) y poller manual.
// Uso: node scripts/trivia_now.js
//   - Si NO hay pregunta activa → lo informa y sale (sin daño).
//   - Si HAY pregunta → flujo ATÓMICO (resuelve con IA y envía en el acto), con
//     fallback que SIEMPRE envía algo. Guarda el HTML crudo en trivia_capturas/.
// Usa EXACTAMENTE el mismo flujo (src/lib/triviaFlow) que correrá el cron, así el
// primer envío supervisado valida el código de producción.
//
// ⚠️ Correr SOLO cuando se quiera comprometer el intento del día (la primera vista
// quema la pregunta). Si no hay pregunta, es seguro correrlo cuantas veces se quiera.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { intentarResponder, mensajeResultado } = require('../src/lib/triviaFlow');

const log = (...a) => console.log('[trivia]', ...a);

(async () => {
  const rep = await intentarResponder({ log });
  log(`ESTADO: ${rep.estado}`);
  if (rep.estado === 'respondida') {
    log(`RESULTADO: ok=${rep.resultado.ok} acierto=${rep.resultado.acierto}`);
    log(`servidor: ${rep.resultado.texto}`);
    log('\n--- Mensaje WhatsApp que enviaría el cron ---\n' + mensajeResultado(rep));
  } else if (rep.estado === 'error') {
    log('ERROR:', rep.error);
  }
})().catch((e) => { console.error('[trivia] FATAL', e.message); process.exit(1); });
