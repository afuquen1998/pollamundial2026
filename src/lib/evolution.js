// Envía un mensaje de texto por WhatsApp vía Evolution API.
// El número conectado a la instancia es el REMITENTE; MI_NUMERO es el DESTINATARIO.
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const URL = (process.env.EVOLUTION_URL || '').replace(/\/$/, '');
const APIKEY = process.env.EVOLUTION_API_KEY;
const INSTANCE = process.env.EVOLUTION_INSTANCE;
const NUMERO = process.env.MI_NUMERO;
const STYLE = process.env.EVOLUTION_BODY_STYLE || 'v2';

async function sendText(texto, numero = NUMERO) {
  if (!URL || !APIKEY || !INSTANCE || !numero) {
    throw new Error('Faltan variables de Evolution (EVOLUTION_URL/API_KEY/INSTANCE/MI_NUMERO)');
  }
  // v2: { number, text } | legacy: { number, textMessage: { text } }
  const body = STYLE === 'legacy'
    ? { number: numero, textMessage: { text: texto } }
    : { number: numero, text: texto };

  const res = await fetch(`${URL}/message/sendText/${encodeURIComponent(INSTANCE)}`, {
    method: 'POST',
    headers: { apikey: APIKEY, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`Evolution ${res.status}: ${txt.slice(0, 300)}`);
  return txt;
}

module.exports = { sendText };
