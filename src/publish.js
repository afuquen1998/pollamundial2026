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

const { select } = require('./lib/supabase');
const { resolveMarcador, publishToTargets } = require('./lib/publishLogic');

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

(async () => {
  const args = parseArgs(process.argv.slice(2));

  const rows = await select(`id,home,away,kickoff,sug_c_h,sug_c_a,sug_a_h,sug_a_a&id=eq.${encodeURIComponent(args.id)}`);
  const row = rows[0];
  if (!row) throw new Error(`Partido ${args.id} no encontrado en la BD`);

  const { gh, ga } = resolveMarcador(row, args.tipo);
  if (gh == null || ga == null) throw new Error(`No hay sugerencia "${args.tipo}" guardada para ${args.id}`);

  console.log(`[publish] ${args.id} (${row.home} vs ${row.away}) -> ${gh}-${ga} | target=${args.target}${args.dryRun ? ' | DRY-RUN' : ''}`);

  const { results, targets } = await publishToTargets(row, gh, ga, args.target, args.dryRun);
  for (const t of targets) {
    const r = results[t];
    console.log(`  ${t}: ${r.ok ? '✓' : '✗'} ${r.detalle || r.motivo || ''}`);
  }

  const todosOk = targets.every((t) => results[t].ok);
  if (!args.dryRun && todosOk) {
    console.log(`[publish] BD actualizada: ${args.id} c_h=${gh} c_a=${ga}`);
  }
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
