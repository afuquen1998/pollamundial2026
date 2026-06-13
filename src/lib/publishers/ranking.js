// Lectura del RANKING (posiciones) en ambas pollas. Solo lee, no escribe.
// Endpoints hallados en FASE 0:
//   PG: GET /posiciones.asp?ajax=1&grupo=&xpag=300&pag=1 → JSON {ok,total,rows:[{pos,nom,pf,pt,p,yo}]}
//       el server marca mi fila con yo=true.
//   PF: menu?pag=quienGana (Playwright) → tabla con header
//       [Pos., Nombre, PJ, ME, AR, ML, MV, Pts.]; mi fila trae "(Tú)" en el nombre.
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '..', '.env') });
const prediccion = require('./prediccion');
const futbolera = require('./futbolera');
const { fetchWithJar } = require('../http');
const { rest } = require('../supabase');

const PG_BASE = process.env.PG_BASE_URL || 'https://www.prediccionganadora.com';
const PF_BASE = process.env.PF_BASE_URL || 'https://www.pollafutboleraalumni.com';

const ents = (s) => String(s)
  .replace(/&aacute;/g, 'á').replace(/&eacute;/g, 'é').replace(/&iacute;/g, 'í')
  .replace(/&oacute;/g, 'ó').replace(/&uacute;/g, 'ú').replace(/&ntilde;/g, 'ñ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#?\w+;/g, ' ');
const strip = (h) => ents(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// A partir de filas [{pos,p,...}] y mi fila, calcula brechas. p = puntos totales.
function brechas(rows, mine) {
  if (!mine) return null;
  const ps = rows.map((r) => r.p).filter((x) => Number.isFinite(x));
  const liderP = ps.length ? Math.max(...ps) : mine.p;
  // cutoff del top-3: menor puntaje entre quienes están en posición <= 3
  const top3ps = rows.filter((r) => r.pos != null && r.pos <= 3).map((r) => r.p);
  const cutoffTop3 = top3ps.length ? Math.min(...top3ps) : liderP;
  return {
    miPuesto: mine.pos,
    miPuntos: mine.p,
    total: rows.length,
    liderPuntos: liderP,
    brechaAlLider: Math.max(0, liderP - mine.p),
    brechaAlTop3: Math.max(0, cutoffTop3 - mine.p),
    enTop3: mine.pos != null && mine.pos <= 3,
  };
}

// PG: devuelve { plataforma:'PG', ...brechas, miPf, miPt } o null si falla.
async function posicionesPG() {
  const jar = prediccion.createJar();
  await prediccion.login(jar);
  const res = await fetchWithJar(jar, `${PG_BASE}/posiciones.asp?ajax=1&grupo=&xpag=300&pag=1`);
  const data = JSON.parse(await res.text());
  const rows = (data.rows || []).map((r) => ({
    pos: Number(r.pos), p: Number(r.p), pf: Number(r.pf), pt: Number(r.pt),
    nom: r.nom, yo: !!r.yo,
  }));
  const mine = rows.find((r) => r.yo);
  const b = brechas(rows, mine);
  if (!b) return null;
  return { plataforma: 'PG', ...b, miPf: mine.pf, miPt: mine.pt, total: data.total || rows.length };
}

// PF: devuelve { plataforma:'PF', ...brechas } o null si falla. Usa Playwright.
async function posicionesPF() {
  const { browser, page } = await futbolera.login();
  try {
    await page.goto(`${PF_BASE}/menu?pag=quienGana`, { waitUntil: 'networkidle', timeout: 40000 });
    const html = await page.content();
    // localizar la tabla cuyo encabezado tiene "Pos." y "Pts."
    const tablas = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map((m) => m[0]);
    const tabla = tablas.find((t) => /pos\.?[\s\S]*nombre[\s\S]*pts/i.test(strip(t))) ||
      tablas.sort((a, b) => (b.match(/<tr/gi) || []).length - (a.match(/<tr/gi) || []).length)[0];
    if (!tabla) return null;
    const filas = [...tabla.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((m) =>
      [...m[0].matchAll(/<t[dh][\s\S]*?<\/t[dh]>/gi)].map((c) => strip(c[0])).filter((c) => c !== '')
    ).filter((c) => c.length >= 3);
    // primera fila = encabezado; datos: [pos, nombre, ...resto..., pts]
    const rows = [];
    for (const c of filas) {
      const pos = parseInt(c[0], 10);
      if (!Number.isFinite(pos)) continue; // saltar encabezado / filas no numéricas
      const nom = c[1] || '';
      const p = parseInt(c[c.length - 1], 10);
      rows.push({ pos, nom, p: Number.isFinite(p) ? p : 0, yo: /\(t[úu]\)/i.test(nom) });
    }
    const mine = rows.find((r) => r.yo);
    const b = brechas(rows, mine);
    if (!b) return null;
    return { plataforma: 'PF', ...b };
  } finally {
    await browser.close();
  }
}

// Cuenta partidos aún por jugar (cerrado=false) con equipos definidos (ignora placeholders).
async function contarRestantes() {
  const rows = await rest('predicciones?select=home,away&cerrado=eq.false');
  const ph = (s = '') => /por definir|to be announced|tbd/i.test(s);
  return rows.filter((r) => !ph(r.home) && !ph(r.away)).length;
}

// Guarda un snapshot diario en ranking_log (upsert por fecha+plataforma).
// `fecha` en 'YYYY-MM-DD'. `plats` = array de resultados de posicionesPG/PF (los null se ignoran).
async function guardarSnapshot(fecha, plats) {
  const filas = plats.filter(Boolean).map((p) => ({
    fecha,
    plataforma: p.plataforma,
    puesto: p.miPuesto,
    puntos: p.miPuntos,
    total: p.total,
    brecha_lider: p.brechaAlLider,
    brecha_top3: p.brechaAlTop3,
  }));
  if (!filas.length) return 0;
  await rest('ranking_log?on_conflict=fecha,plataforma', {
    method: 'POST',
    body: filas,
    headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
  });
  return filas.length;
}

module.exports = { posicionesPG, posicionesPF, brechas, guardarSnapshot, contarRestantes };
