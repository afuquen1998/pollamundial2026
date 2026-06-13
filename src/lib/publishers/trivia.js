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
//
// Estrategia (robusta, basada en rutinas.js): los sec/cod/idRespuesta vienen en las
// llamadas onclick SeleccionarRespuestaTrivia(SecTrivia, CodTrivia, IdRespuesta); los
// TEXTOS de las opciones están en #respuesta1..4 (así lo confirma rutinas.js). Se
// extraen por separado y se emparejan por orden → no depende de cómo esté envuelto el DOM.
function parseTrivia(html) {
  if (!/id=["']pregunta["']/i.test(html) && !/SeleccionarRespuestaTrivia/i.test(html)) return null;

  // 1) Todas las llamadas SeleccionarRespuestaTrivia(sec, cod, id), en orden.
  //    Se descarta la firma de la función (params SecTrivia/CodTrivia/IdRespuesta) por si acaso.
  const calls = [...html.matchAll(/SeleccionarRespuestaTrivia\(\s*['"]?([^,'")]+?)['"]?\s*,\s*['"]?([^,'")]+?)['"]?\s*,\s*['"]?([^,'")]+?)['"]?\s*\)/gi)]
    .map((m) => ({ sec: m[1].trim(), cod: m[2].trim(), id: m[3].trim() }))
    .filter((c) => !/Trivia$/i.test(c.sec) && !/Trivia$/i.test(c.cod)); // descarta SecTrivia/CodTrivia/IdRespuesta

  // 2) Textos de las opciones por #respuesta1..4.
  const textos = [];
  for (let i = 1; i <= 4; i++) {
    const mm = new RegExp(`id=["']respuesta${i}["'][^>]*>([\\s\\S]*?)</`, 'i').exec(html);
    textos[i - 1] = mm ? limpiar(mm[1]) : '';
  }

  // 3) Construir opciones emparejando id (de las calls) con texto (de #respuestaN).
  let opciones = [];
  let sec = null, cod = null;
  if (calls.length) {
    sec = calls[0].sec; cod = calls[0].cod;
    opciones = calls.map((c, i) => ({ id: c.id, texto: textos[i] || `Opción ${i + 1}` }));
  } else {
    // Sin onclick parseable → al menos usar los textos (id 1..n como último recurso).
    opciones = textos.filter(Boolean).map((t, i) => ({ id: String(i + 1), texto: t }));
  }
  if (!opciones.length) return null;

  // 4) Pregunta: texto del elemento #pregunta.
  const pm = /id=["']pregunta["'][^>]*>([\s\S]*?)<\/(?:div|p|span|h\d|td|label)>/i.exec(html);
  const pregunta = pm ? limpiar(pm[1]) : limpiar((/id=["']pregunta["'][^>]*>([\s\S]{0,400})/i.exec(html) || [])[1] || '');

  // 5) Segundos: innerHTML/value de #casilla-segundos. Default 20.
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
