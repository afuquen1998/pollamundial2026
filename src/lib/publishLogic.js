// Lógica compartida de publicación (usada por publish.js CLI y server.js webhook).
// ⚠️ Las dos pollas puntúan distinto → el óptimo "seguro"/"arriesgado" puede diferir
// por plataforma. resolveMarcador resuelve por plataforma; publishToTargets publica
// en cada polla SU marcador y registra el estado por separado (c_* = PG, c_pf_* = PF).
const { update } = require('./supabase');
const { findMatch } = require('./teams');
const prediccion = require('./publishers/prediccion');
const futbolera = require('./publishers/futbolera');

// Resuelve el marcador para una plataforma ('prediccion' | 'futbolera') y un tipo.
//   'seguro' / 'arriesgado' → sugerencia guardada (PG usa sug_c_*/sug_a_*,
//      PF usa sug_pf_c_*/sug_pf_a_* y cae a la de PG si aún no se calculó).
//   '<h>-<a>' → marcador manual (igual en ambas).
function resolveMarcador(row, tipo, plataforma = 'prediccion') {
  const esPF = plataforma === 'futbolera';
  if (tipo === 'seguro') {
    return esPF
      ? { gh: row.sug_pf_c_h ?? row.sug_c_h, ga: row.sug_pf_c_a ?? row.sug_c_a }
      : { gh: row.sug_c_h, ga: row.sug_c_a };
  }
  if (tipo === 'arriesgado') {
    return esPF
      ? { gh: row.sug_pf_a_h ?? row.sug_a_h, ga: row.sug_pf_a_a ?? row.sug_a_a }
      : { gh: row.sug_a_h, ga: row.sug_a_a };
  }
  const m = String(tipo).match(/^(\d+)-(\d+)$/);
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

// Publica para `row` en los targets indicados ('ambas'|'futbolera'|'prediccion').
// `tipo` ('seguro'|'arriesgado'|'<h>-<a>') se resuelve POR plataforma → cada polla
// recibe su marcador óptimo. Cada result incluye el {gh,ga} efectivamente usado.
// No dry-run: registra c_*/pub_pg (PG) y c_pf_*/pub_pf (PF) por separado.
async function publishToTargets(row, tipo, target, dryRun) {
  const targets = target === 'ambas' ? ['prediccion', 'futbolera'] : [target];
  const results = {};
  for (const t of targets) {
    let gh, ga;
    try {
      ({ gh, ga } = resolveMarcador(row, tipo, t));
    } catch (e) {
      results[t] = { ok: false, motivo: e.message };
      continue;
    }
    if (gh == null || ga == null) {
      results[t] = { ok: false, motivo: `sin sugerencia "${tipo}" guardada`, gh: null, ga: null };
      continue;
    }
    try {
      const r = t === 'prediccion'
        ? await publishPrediccion(row, gh, ga, dryRun)
        : await publishFutbolera(row, gh, ga, dryRun);
      results[t] = { ...r, gh, ga };
    } catch (e) {
      results[t] = { ok: false, motivo: e.message, gh, ga };
    }
  }

  if (!dryRun) {
    const patch = {};
    const now = new Date().toISOString();
    if (results.prediccion?.ok) {
      patch.c_h = results.prediccion.gh; patch.c_a = results.prediccion.ga;
      patch.pub_c_h = results.prediccion.gh; patch.pub_c_a = results.prediccion.ga;
      patch.pub_pg_at = now;
    }
    if (results.futbolera?.ok) {
      patch.c_pf_h = results.futbolera.gh; patch.c_pf_a = results.futbolera.ga;
      patch.pub_pf_at = now;
    }
    if (Object.keys(patch).length) await update(row.id, patch);
  }

  const todosOk = targets.every((t) => results[t].ok);
  return { results, todosOk, targets };
}

module.exports = { resolveMarcador, publishToTargets };
