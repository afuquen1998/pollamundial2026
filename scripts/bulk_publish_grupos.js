// Publicación masiva inicial: carga c_h/c_a (ya definidos en la BD) de todos los
// partidos de fase de grupos (A1..L6) que aún NO se hayan publicado y que no
// hayan jugado todavía, en Predicción Ganadora y Polla Futbolera. Login una sola
// vez por plataforma (Futbolera además agrupa por "fecha" en un solo POST).
// Uso: node scripts/bulk_publish_grupos.js [--dry-run]
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { select, update } = require('../src/lib/supabase');
const { findMatch } = require('../src/lib/teams');
const prediccion = require('../src/lib/publishers/prediccion');
const futbolera = require('../src/lib/publishers/futbolera');

const DRY_RUN = process.argv.includes('--dry-run');

async function getPendientes() {
  const rows = await select('select=id,home,away,kickoff,c_h,c_a,cerrado,pub_c_h,pub_c_a,pub_pf_at,pub_pg_at&order=kickoff');
  return rows.filter((r) =>
    /^[A-L][1-6]$/.test(r.id) &&
    !r.cerrado &&
    r.c_h != null &&
    r.c_a != null &&
    (r.pub_pf_at == null || r.pub_pg_at == null || r.pub_c_h !== r.c_h || r.pub_c_a !== r.c_a)
  );
}

async function publicarPrediccion(pendientes) {
  console.log('\n=== Predicción Ganadora ===');
  const jar = prediccion.createJar();
  await prediccion.login(jar);
  console.log('login OK');
  const partidos = await prediccion.listPartidos(jar);
  console.log(`listPartidos: ${partidos.length} partidos en la web`);

  const resultado = {};
  for (const row of pendientes) {
    const match = findMatch(row, partidos);
    if (!match) {
      resultado[row.id] = { ok: false, motivo: 'no encontrado' };
      console.log(`  ${row.id} ${row.home} vs ${row.away} -> NO ENCONTRADO`);
      continue;
    }
    if (DRY_RUN) {
      resultado[row.id] = { ok: true, dryRun: true };
      console.log(`  ${row.id} ${row.home} vs ${row.away} -> id=${match.id} (${match.home}/${match.away}) -> ${row.c_h}-${row.c_a} [dry-run]`);
      continue;
    }
    try {
      await prediccion.setMarcador(jar, match, row.c_h, row.c_a);
      resultado[row.id] = { ok: true };
      console.log(`  ${row.id} ${row.home} vs ${row.away} -> id=${match.id} -> ${row.c_h}-${row.c_a} OK`);
    } catch (e) {
      resultado[row.id] = { ok: false, motivo: e.message };
      console.log(`  ${row.id} ERROR: ${e.message}`);
    }
  }
  return resultado;
}

async function publicarFutbolera(pendientes) {
  console.log('\n=== Polla Futbolera ===');
  const { browser, page } = await futbolera.login();
  console.log('login OK');
  const resultado = {};
  const pendientesRestantes = new Set(pendientes.map((r) => r.id));

  try {
    for (let fecha = 3; fecha <= 17 && pendientesRestantes.size > 0; fecha++) {
      const { codigoFecha, partidos } = await futbolera.leerFecha(page, fecha);
      if (!partidos.length) continue;

      const marcadores = [];
      const idsEnFecha = [];
      for (const row of pendientes) {
        if (!pendientesRestantes.has(row.id)) continue;
        const match = findMatch(row, partidos);
        if (!match) continue;
        marcadores.push({ i: match.i, gh: row.c_h, ga: row.c_a });
        idsEnFecha.push(row.id);
      }
      if (!marcadores.length) continue;

      console.log(`  fecha=${codigoFecha}: ${idsEnFecha.join(', ')}`);
      if (!DRY_RUN) {
        await futbolera.setMarcadores(page, marcadores);
      }
      for (const id of idsEnFecha) {
        resultado[id] = { ok: true, ...(DRY_RUN ? { dryRun: true } : {}) };
        pendientesRestantes.delete(id);
      }
    }
  } finally {
    await browser.close();
  }

  for (const id of pendientesRestantes) {
    resultado[id] = { ok: false, motivo: 'no encontrado en ninguna fecha' };
    console.log(`  ${id} -> NO ENCONTRADO en ninguna fecha`);
  }
  return resultado;
}

(async () => {
  const pendientes = await getPendientes();
  console.log(`Partidos pendientes (no jugados, con marcador, sin publicar): ${pendientes.length}`);
  if (DRY_RUN) console.log('*** MODO DRY-RUN: no se escribe nada ***');

  const resPg = await publicarPrediccion(pendientes);
  const resPf = await publicarFutbolera(pendientes);

  console.log('\n=== Resumen ===');
  let okAmbas = 0;
  for (const row of pendientes) {
    const pg = resPg[row.id] || { ok: false, motivo: 'sin intentar' };
    const pf = resPf[row.id] || { ok: false, motivo: 'sin intentar' };
    const okTodos = pg.ok && pf.ok;
    if (okTodos) okAmbas++;
    const estado = okTodos ? '✅' : '⚠️';
    console.log(`${estado} ${row.id} ${row.home} ${row.c_h}-${row.c_a} ${row.away} | PG:${pg.ok ? 'OK' : 'FAIL(' + pg.motivo + ')'} | PF:${pf.ok ? 'OK' : 'FAIL(' + pf.motivo + ')'}`);

    if (!DRY_RUN && okTodos) {
      const now = new Date().toISOString();
      await update(row.id, { pub_c_h: row.c_h, pub_c_a: row.c_a, pub_pf_at: now, pub_pg_at: now });
    }
  }
  console.log(`\nTotal OK en ambas: ${okAmbas}/${pendientes.length}`);
})().catch((e) => {
  console.error('ERROR FATAL:', e);
  process.exit(1);
});
