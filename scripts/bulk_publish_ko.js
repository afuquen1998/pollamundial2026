// Publicación masiva de ELIMINATORIAS: carga el marcador SEGURO sugerido de cada
// plataforma (PG=sug_c_*, PF=sug_pf_c_* con fallback a sug_c_*) en los Kxx que ya
// tengan equipos y sugerencia, login una sola vez por plataforma. En PG el penalti
// (4-3 por defecto) lo añade setMarcador solo y preserva el que ya esté cargado.
// Por defecto procesa los 16avos K74..K88 (K73 se excluye: ya cargado a mano).
// Uso: node scripts/bulk_publish_ko.js [--dry-run] [--min 74] [--max 88]
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { select, update } = require('../src/lib/supabase');
const { findMatch } = require('../src/lib/teams');
const prediccion = require('../src/lib/publishers/prediccion');
const futbolera = require('../src/lib/publishers/futbolera');

const DRY_RUN = process.argv.includes('--dry-run');
const argN = (flag, def) => { const i = process.argv.indexOf(flag); return i >= 0 ? Number(process.argv[i + 1]) : def; };
const MIN = argN('--min', 74), MAX = argN('--max', 88);
const ph = (s = '') => /por definir|to be|tbd/i.test(s);

const segPG = (r) => ({ gh: r.sug_c_h, ga: r.sug_c_a });
const segPF = (r) => ({ gh: r.sug_pf_c_h ?? r.sug_c_h, ga: r.sug_pf_c_a ?? r.sug_c_a });

async function getPendientes() {
  const cols = 'id,home,away,kickoff,cerrado,sug_c_h,sug_c_a,sug_pf_c_h,sug_pf_c_a';
  const rows = await select(`select=${cols}&id=like.K*&order=kickoff`);
  return rows.filter((r) => {
    const n = Number(String(r.id).replace(/\D/g, ''));
    return n >= MIN && n <= MAX && !r.cerrado && !ph(r.home) && !ph(r.away) && r.sug_c_h != null;
  });
}

async function publicarPG(pend) {
  console.log('\n=== Predicción Ganadora ===');
  const jar = prediccion.createJar();
  await prediccion.login(jar);
  const partidos = await prediccion.listPartidos(jar);
  console.log(`login OK · ${partidos.length} partidos en la web`);
  const res = {};
  for (const row of pend) {
    const match = findMatch(row, partidos);
    const { gh, ga } = segPG(row);
    if (!match) { res[row.id] = { ok: false, motivo: 'no encontrado' }; console.log(`  ${row.id} -> NO ENCONTRADO`); continue; }
    if (DRY_RUN) { res[row.id] = { ok: true, gh, ga }; console.log(`  ${row.id} ${row.home} vs ${row.away} -> id=${match.id} pen=${match.penaltis} -> ${gh}-${ga} [dry]`); continue; }
    try { await prediccion.setMarcador(jar, match, gh, ga); res[row.id] = { ok: true, gh, ga }; console.log(`  ${row.id} -> ${gh}-${ga} OK`); }
    catch (e) { res[row.id] = { ok: false, motivo: e.message }; console.log(`  ${row.id} ERROR ${e.message}`); }
  }
  return res;
}

async function publicarPF(pend) {
  console.log('\n=== Polla Futbolera ===');
  const PF_BASE = process.env.PF_BASE_URL || 'https://www.pollafutboleraalumni.com';
  const { browser, page } = await futbolera.login();
  console.log('login OK');
  const res = {};
  const restan = new Set(pend.map((r) => r.id));
  try {
    // leer las "fechas" realmente disponibles en el selector (no adivinar números)
    await page.goto(`${PF_BASE}/menu?pag=jugar`);
    const fechas = await page.$$eval('#formaFecha select[name="codigoFecha"] option',
      (os) => os.map((o) => o.value).filter((v) => v !== ''));
    console.log('fechas disponibles:', fechas.join(','));
    for (const fecha of fechas) {
      if (restan.size === 0) break;
      const { codigoFecha, partidos } = await futbolera.leerFecha(page, fecha);
      if (!partidos.length) continue;
      const marcadores = [], ids = [];
      for (const row of pend) {
        if (!restan.has(row.id)) continue;
        const match = findMatch(row, partidos);
        if (!match) continue;
        const { gh, ga } = segPF(row);
        marcadores.push({ i: match.i, gh, ga }); ids.push(row.id);
        res[row.id] = { ok: true, gh, ga };
      }
      if (!marcadores.length) continue;
      console.log(`  fecha=${codigoFecha}: ${ids.join(', ')}${DRY_RUN ? ' [dry]' : ''}`);
      if (!DRY_RUN) await futbolera.setMarcadores(page, marcadores);
      ids.forEach((id) => restan.delete(id));
    }
  } finally { await browser.close(); }
  for (const id of restan) { res[id] = { ok: false, motivo: 'no encontrado en ninguna fecha' }; console.log(`  ${id} -> NO ENCONTRADO`); }
  return res;
}

(async () => {
  const pend = await getPendientes();
  console.log(`Pendientes (K${MIN}..K${MAX} con sugerencia): ${pend.length}${DRY_RUN ? ' · DRY-RUN' : ''}`);
  if (!pend.length) return;
  const rPG = await publicarPG(pend);
  const rPF = await publicarPF(pend);
  console.log('\n=== Resumen ===');
  let ok = 0;
  for (const row of pend) {
    const pg = rPG[row.id] || { ok: false }, pf = rPF[row.id] || { ok: false };
    const todo = pg.ok && pf.ok; if (todo) ok++;
    console.log(`${todo ? '✅' : '⚠️'} ${row.id} ${row.home} vs ${row.away} | PG ${pg.ok ? pg.gh + '-' + pg.ga : 'FAIL:' + pg.motivo} | PF ${pf.ok ? pf.gh + '-' + pf.ga : 'FAIL:' + pf.motivo}`);
    if (!DRY_RUN) {
      const patch = {}, now = new Date().toISOString();
      if (pg.ok) { patch.c_h = pg.gh; patch.c_a = pg.ga; patch.pub_c_h = pg.gh; patch.pub_c_a = pg.ga; patch.pub_pg_at = now; }
      if (pf.ok) { patch.c_pf_h = pf.gh; patch.c_pf_a = pf.ga; patch.pub_pf_at = now; }
      if (Object.keys(patch).length) await update(row.id, patch);
    }
  }
  console.log(`\nOK en ambas: ${ok}/${pend.length}`);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
