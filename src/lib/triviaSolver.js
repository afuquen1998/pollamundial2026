// Solver de la Trivia Ganadora. Recibe pregunta + opciones, elige una con gpt-5
// (effort low, SIN web_search → rápido, sin latencia de búsqueda en vivo). Temática:
// historia de Mundiales (el modelo ya la sabe) + datos de Areandina precargados.
//
// Diseño para los 20s de un solo tiro: solve() tiene timeout duro; si falla o tarda,
// el llamador debe enviar igual una opción de fallback (25% > 0%). Nunca dejar expirar.
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const path = require('path');
const { respond } = require('./openai');

const PACK = (() => {
  try { return fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'areandina.md'), 'utf8'); }
  catch { return ''; }
})();

const TIMEOUT_MS = Number(process.env.TRIVIA_TIMEOUT_MS || 12000);
const EFFORT = process.env.TRIVIA_EFFORT || 'low';
const MAXTOK = Number(process.env.TRIVIA_MAX_TOKENS || 3000);

const SYSTEM =
  'Eres experto en historia de los Mundiales de fútbol (Copa del Mundo FIFA) y en datos ' +
  'de la universidad colombiana AREANDINA. Respondes preguntas de opción múltiple eligiendo ' +
  'la ÚNICA opción correcta.\n\n' +
  'DATOS DE AREANDINA (referencia):\n' + PACK + '\n\n' +
  'REGLAS DE RESPUESTA:\n' +
  '- Responde SOLO en el formato exacto:  N | razón_corta\n' +
  '  donde N es el número de la opción correcta (1, 2, 3 o 4).\n' +
  '- La razón es máximo 5 palabras. No agregues nada más.';

// Construye el input del usuario: pregunta + opciones numeradas 1..n.
function buildInput(pregunta, opciones) {
  const lineas = opciones.map((o, i) => `${i + 1}) ${o.texto}`).join('\n');
  return `Pregunta: ${pregunta}\nOpciones:\n${lineas}\n\nResponde con: N | razón_corta`;
}

// Extrae el número de opción (1..n) de la respuesta del modelo.
function parseEleccion(text, n) {
  const m = String(text).match(/[1-9]/); // primer dígito 1-9
  if (!m) return null;
  const num = Number(m[0]);
  return num >= 1 && num <= n ? num : null;
}

// Resuelve la trivia. Devuelve { idRespuesta, indice, razon, ms } o lanza si falla/timeout.
// opciones = [{ id, texto }] (id = IdRespuesta de la plataforma).
async function solve(pregunta, opciones, { timeoutMs = TIMEOUT_MS } = {}) {
  if (!opciones || !opciones.length) throw new Error('sin opciones');
  const t0 = Date.now();
  const input = buildInput(pregunta, opciones);

  const llamada = respond({ system: SYSTEM, input, webSearch: false, effort: EFFORT, maxOutputTokens: MAXTOK });
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout solver')), timeoutMs));
  const { text } = await Promise.race([llamada, timeout]);

  const num = parseEleccion(text, opciones.length);
  if (!num) throw new Error(`respuesta no parseable: "${String(text).slice(0, 60)}"`);
  const indice = num - 1;
  const razon = (String(text).split('|')[1] || '').trim().slice(0, 40);
  return { idRespuesta: opciones[indice].id, indice, razon, ms: Date.now() - t0 };
}

module.exports = { solve, buildInput, parseEleccion, SYSTEM };
