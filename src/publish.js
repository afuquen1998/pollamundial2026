// CLI para publicar (a mano) el marcador de un partido en las plataformas.
// Uso:
//   node src/publish.js --id A6 --tipo seguro|arriesgado|<h>-<a> [--target ambas|futbolera|prediccion] [--dry-run]
//
// - "seguro"     -> usa sug_c_h/sug_c_a (última sugerencia conservadora).
// - "arriesgado" -> usa sug_a_h/sug_a_a (última sugerencia agresiva).
// - "2-1"        -> marcador manual.
//
// En Polla Futbolera busca el partido en la "fecha" seleccionada por defecto
// (la del día, según vimos en menu?pag=jugar). Si el partido no aparece ahí,
// reporta error (no itera otras fechas).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { select, update } = require('./lib/supabase');
const { findMatch } = require('./lib/teams');
const prediccion = require('./lib/publishers/prediccion');
const futbolera = require('./lib/publishers/futbolera');

function parseArgs(argv) {
  const args = { target: process.env.PUBLISH_DEFAULT_TARGET || 'ambas', dryRun: argv.includes('--dry-run') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--id') args.id = argv[++i];
    else if (argv[i] === '--tipo') args.tipo = argv[++i];
    else if (argv[i] === '--target') args.target = argv[++i];
  }
  if (!args.id || !args.tipo) {
    throw new Error('Uso: node src/publish.js --id A6 --tipo seguro|arriesgado|<h>-<a> [--target ambas|futbolera|prediccion] [--dry-run]');
  }
  if (!['ambas', 'futbolera', 'prediccion'].includes(args.target)) {
    throw new Error(`--target inválido: ${args.target}`);
  }
  return args;
}

function resolveMarcador(row, tipo) {
  if (tipo === 'seguro') return { gh: row.sug_c_h, ga: row.sug_c_a };
  if (tipo === 'arriesgado') return { gh: row.sug_a_h, ga: row.sug_a_a };
  const m = tipo.match(/^(\d+)-(\d+)$/);
  if (!m) throw new Error(`--tipo inválido: ${tipo}`);
  return { gh: Number(m[1]), ga: Number(m[2]) };
}

async function publishPrediccion(row, gh, ga, dryRun) {
  const jar = prediccion.createJar();
  await prediccion.login(jar);
  const partidos = await prediccion.listPartidos(jar);
  const match = findMatch(row, partidos);
  if (!match) return { ok: false, motivo: 'no encontrado en Predicción Ganadora' };
  if (dryRun) return { ok: true, dryRun: true, detalle: `id=${match.id} (${match.home} vs ${match.away}) -> ${gh}-${ga}` };
  await prediccion.setMarcador(jar, match, gh, ga);
  return { ok: true, detalle: `id=${match.id} (${match.home} vs ${match.away}) -> ${gh}-${ga}` };
}

async function publishFutbolera(row, gh, ga, dryRun) {
  const { browser, page } = await futbolera.login();
  try {
    const { codigoFecha, partidos } = await futbolera.leerFecha(page);
    const match = findMatch(row, partidos);
    if (!match) return { ok: false, motivo: `no encontrado en Polla Futbolera (fecha ${codigoFecha})` };
    if (dryRun) return { ok: true, dryRun: true, detalle: `fecha=${codigoFecha} partido${match.i} (${match.home} vs ${match.away}) -> ${gh}-${ga}` };
    await futbolera.setMarcadores(page, [{ i: match.i, gh, ga }]);
    return { ok: true, detalle: `fecha=${codigoFecha} partido${match.i} (${match.home} vs ${match.away}) -> ${gh}-${ga}` };
  } finally {
    await browser.close();
  }
}

(async () => {
  const args = parseArgs(process.argv.slice(2));

  const rows = await select(`id,home,away,kickoff,sug_c_h,sug_c_a,sug_a_h,sug_a_a&id=eq.${encodeURIComponent(args.id)}`);
  const row = rows[0];
  if (!row) throw new Error(`Partido ${args.id} no encontrado en la BD`);

  const { gh, ga } = resolveMarcador(row, args.tipo);
  if (gh == null || ga == null) throw new Error(`No hay sugerencia "${args.tipo}" guardada para ${args.id}`);

  console.log(`[publish] ${args.id} (${row.home} vs ${row.away}) -> ${gh}-${ga} | target=${args.target}${args.dryRun ? ' | DRY-RUN' : ''}`);

  const targets = args.target === 'ambas' ? ['prediccion', 'futbolera'] : [args.target];
  const results = {};
  for (const t of targets) {
    try {
      results[t] = t === 'prediccion'
        ? await publishPrediccion(row, gh, ga, args.dryRun)
        : await publishFutbolera(row, gh, ga, args.dryRun);
    } catch (e) {
      results[t] = { ok: false, motivo: e.message };
    }
    const r = results[t];
    console.log(`  ${t}: ${r.ok ? '✓' : '✗'} ${r.detalle || r.motivo || ''}`);
  }

  const todosOk = targets.every((t) => results[t].ok);
  if (!args.dryRun && todosOk) {
    await update(row.id, { c_h: gh, c_a: ga });
    console.log(`[publish] BD actualizada: ${args.id} c_h=${gh} c_a=${ga}`);
  }
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
