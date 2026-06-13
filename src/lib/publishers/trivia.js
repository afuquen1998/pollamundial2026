// Publisher de la TRIVIA en Predicción Ganadora. Reusa el login HTTP de prediccion.js.
//
// ⚠️ REGLA DE ORO: GET /trivia.asp con pregunta activa "quema" la vista y arranca el
// reloj de 20s (un solo tiro; recargar = perder). Llamar hayPregunta() SOLO cuando se
// esté listo a resolver y enviar en el acto (flujo atómico).
//
// ⚠️ PARSER TENTATIVO: la estructura del HTML con pregunta viva no se pudo capturar
// (no había trivia activa en FASE 0). Se basa en la lógica conocida de js/rutinas.js
// (SeleccionarRespuestaTrivia(sec, cod, idRespuesta), #pregunta, #casilla-segundos).
// VERIFICAR/ajustar contra el HTML real en A0 (primer envío supervisado).
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '..', '.env') });
const { createJar, login } = require('./prediccion');
const { fetchWithJar } = require('../http');

const BASE = process.env.PG_BASE_URL || 'https://www.prediccionganadora.com';
const ents = (s) => String(s).replace(/&aacute;/g, 'á').replace(/&eacute;/g, 'é').replace(/&iacute;/g, 'í')
  .replace(/&oacute;/g, 'ó').replace(/&uacute;/g, 'ú').replace(/&ntilde;/g, 'ñ').replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#?\w+;/g, ' ');
const limpiar = (h) => ents(String(h).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// Parsea el HTML de trivia.asp. Devuelve null si no hay pregunta activa, o
// { sec, cod, pregunta, opciones:[{id,texto}], segundos, html }.
function parseTrivia(html) {
  if (!/id=["']pregunta["']/i.test(html) && !/SeleccionarRespuestaTrivia/i.test(html)) return null;

  // Opciones: cada elemento con onclick SeleccionarRespuestaTrivia(sec, cod, idRespuesta).
  // Captura args + texto interno del mismo elemento.
  const opciones = [];
  let sec = null, cod = null;
  const re = /<([a-z]+)\b[^>]*onclick=["'][^"']*SeleccionarRespuestaTrivia\(\s*['"]?([^,'")]+)['"]?\s*,\s*['"]?([^,'")]+)['"]?\s*,\s*['"]?([^,'")]+)['"]?\s*\)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(html))) {
    sec = sec ?? m[2].trim();
    cod = cod ?? m[3].trim();
    const id = m[4].trim();
    const texto = limpiar(m[5]);
    if (texto) opciones.push({ id, texto });
  }

  // Fallback de opciones por #respuesta1..4 si el regex anterior no capturó textos.
  if (!opciones.length) {
    for (let i = 1; i <= 4; i++) {
      const mm = new RegExp(`id=["']respuesta${i}["'][^>]*>([\\s\\S]*?)<`, 'i').exec(html);
      if (mm) opciones.push({ id: String(i), texto: limpiar(mm[1]) });
    }
  }
  if (!opciones.length) return null;

  // Pregunta: texto del elemento #pregunta.
  const pm = /id=["']pregunta["'][^>]*>([\s\S]*?)<\/(?:div|p|span|h\d|td)>/i.exec(html);
  const pregunta = pm ? limpiar(pm[1]) : limpiar((/id=["']pregunta["'][^>]*>([\s\S]{0,400})/i.exec(html) || [])[1] || '');

  // Segundos: value de #casilla-segundos (o su texto). Default 20.
  const sm = /id=["']casilla-segundos["'][^>]*value=["'](\d+)["']/i.exec(html)
    || /id=["']casilla-segundos["'][^>]*>\s*(\d+)/i.exec(html);
  const segundos = sm ? Number(sm[1]) : 20;

  return { sec, cod, pregunta, opciones, segundos, html };
}

// GET /trivia.asp y parsea. ⚠️ QUEMA LA VISTA si hay pregunta → llamar solo cuando
// se vaya a responder en el acto. Devuelve null si no hay pregunta activa.
async function hayPregunta(jar) {
  const res = await fetchWithJar(jar, `${BASE}/trivia.asp`);
  const html = await res.text();
  return parseTrivia(html);
}

// Envía la respuesta: GET /resultado-trivia.asp?sec=&cod=&r=<idRespuesta>&t=<segundos_restantes>.
// Devuelve { ok, acierto, texto }. `acierto` puede ser null si no se logra detectar.
async function responder(jar, { sec, cod, idRespuesta, t }) {
  const qs = new URLSearchParams({ sec: String(sec ?? ''), cod: String(cod ?? ''), r: String(idRespuesta), t: String(t ?? 0) });
  const res = await fetchWithJar(jar, `${BASE}/resultado-trivia.asp?${qs.toString()}`);
  const html = await res.text();
  const txt = limpiar(html).toLowerCase();
  let acierto = null;
  if (/correct|acertaste|felicit|¡bien|respuesta correcta/i.test(txt)) acierto = true;
  else if (/incorrect|errad|fallaste|lo sentimos|respuesta correcta era|no acertaste/i.test(txt)) acierto = false;
  return { ok: res.ok, acierto, texto: txt.slice(0, 200) };
}

module.exports = { hayPregunta, responder, parseTrivia, createJar, login };
