// Lógica compartida de publicación (usada por publish.js CLI y server.js webhook).
const { update } = require('./supabase');
const { findMatch } = require('./teams');
const prediccion = require('./publishers/prediccion');
const futbolera = require('./publishers/futbolera');

// tipo: 'seguro' | 'arriesgado' | '<h>-<a>'
function resolveMarcador(row, tipo) {
  if (tipo === 'seguro') return { gh: row.sug_c_h, ga: row.sug_c_a };
  if (tipo === 'arriesgado') return { gh: row.sug_a_h, ga: row.sug_a_a };
  const m = tipo.match(/^(\d+)-(\d+)$/);
  if (!m) throw new Error(`tipo inválido: ${tipo}`);
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

// Publica gh-ga para `row` en los targets indicados ('ambas'|'futbolera'|'prediccion').
// Si todos los targets resultan ok y no es dry-run, actualiza c_h/c_a en la BD.
async function publishToTargets(row, gh, ga, target, dryRun) {
  const targets = target === 'ambas' ? ['prediccion', 'futbolera'] : [target];
  const results = {};
  for (const t of targets) {
    try {
      results[t] = t === 'prediccion'
        ? await publishPrediccion(row, gh, ga, dryRun)
        : await publishFutbolera(row, gh, ga, dryRun);
    } catch (e) {
      results[t] = { ok: false, motivo: e.message };
    }
  }
  const todosOk = targets.every((t) => results[t].ok);
  if (!dryRun && todosOk) {
    await update(row.id, { c_h: gh, c_a: ga });
  }
  return { results, todosOk, targets };
}

module.exports = { resolveMarcador, publishToTargets };
