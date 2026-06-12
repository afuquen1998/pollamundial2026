// Carga seed_predicciones.json + kickoffs.json en la tabla `predicciones` (upsert por id).
// Normaliza al orden oficial FIFA: si el seed tiene home/away invertido vs el calendario,
// intercambia equipos y marcadores para que coincida con lo que ves en la plataforma de la polla.
// Flag --keep-seed-orientation para NO normalizar.
const fs = require('fs');
const path = require('path');
const { upsert, select } = require('../src/lib/supabase');

const ROOT = path.join(__dirname, '..');
const KEEP = process.argv.includes('--keep-seed-orientation');

async function main() {
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'seed_predicciones.json'), 'utf8')).partidos;
  const kicks = JSON.parse(fs.readFileSync(path.join(ROOT, 'kickoffs.json'), 'utf8'));

  let swapped = 0;
  const rows = seed.map((p) => {
    const k = kicks[p.id] || {};
    let { home, away } = p;
    let [c_h, c_a] = p.c;
    let [a_h, a_a] = p.a;
    if (k.inverted && !KEEP) {
      [home, away] = [away, home];
      [c_h, c_a] = [c_a, c_h];
      [a_h, a_a] = [a_a, a_h];
      swapped++;
    }
    return {
      id: p.id, grupo: p.grupo, home, away,
      kickoff: k.kickoff || null, location: k.location || null,
      conf: p.conf, c_h, c_a, a_h, a_a, cerrado: false,
    };
  });

  await upsert(rows);
  const all = await select('select=id&order=id');
  console.log(`Upsert OK. Filas en tabla: ${all.length}/72. Invertidos normalizados a orden FIFA: ${swapped}.`);

  const sinKick = rows.filter((r) => !r.kickoff).map((r) => r.id);
  if (sinKick.length) console.warn('Sin kickoff:', sinKick.join(','));
}

main().catch((e) => { console.error('load_seed falló:', e.message); process.exit(1); });
