// Prueba de src/lib/publishers/prediccion.js: login, lista de partidos,
// match contra la BD y un guardado IDEMPOTENTE (mismo marcador que ya está
// cargado en la plataforma, no cambia nada).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { select } = require('../src/lib/supabase');
const { findMatch } = require('../src/lib/teams');
const pg = require('../src/lib/publishers/prediccion');

(async () => {
  const jar = pg.createJar();
  console.log('Login...');
  await pg.login(jar);
  console.log('Login OK');

  const partidos = await pg.listPartidos(jar);
  console.log(`listPartidos: ${partidos.length} partidos`);
  console.log(partidos.slice(0, 5));

  const rows = await select('id,home,away,kickoff,c_h,c_a&order=kickoff');
  const candidato = partidos[0];
  const partido = rows.find((r) => findMatch(r, [candidato]));
  if (!partido) {
    console.log('No hubo match para el primer candidato, abortando.');
    return;
  }
  const match = findMatch(partido, partidos);
  console.log(`Match: BD ${partido.id} (${partido.home} vs ${partido.away}) -> PG id=${match.id} (${match.home} vs ${match.away})`);

  console.log(`Guardando marcador IDEMPOTENTE ${candidato.id === match.id ? '' : '(otro)'} -> gh=0 ga=2 (mismo valor visto en browse para id=5)`);
  // Guardado idempotente: reenvía el mismo marcador 0-2 ya cargado para id=5 (Catar-Suiza).
  const target = partidos.find((p) => p.id === 5);
  await pg.setMarcador(jar, target, 0, 2);
  console.log('setMarcador OK (idempotente)');
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
