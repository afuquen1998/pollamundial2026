// Prueba rápida de src/lib/teams.js: matchea los 8 partidos de ejemplo de
// Predicción Ganadora (§2.1 del plan) contra las filas reales de la BD.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { select } = require('../src/lib/supabase');
const { findMatch } = require('../src/lib/teams');

// Ejemplos capturados de partidos.asp?tc=t (id=N el=local ev=visitante)
const candidatos = [
  { pgId: 5, home: 'CATAR', away: 'SUIZA' },
  { pgId: 6, home: 'BRASIL', away: 'MARRUECOS' },
  { pgId: 7, home: 'HAITI', away: 'ESCOCIA' },
  { pgId: 8, home: 'AUSTRALIA', away: 'TURQUIA' },
  { pgId: 9, home: 'ALEMANIA', away: 'CURAZAO' },
  { pgId: 10, home: 'PAISES BAJOS', away: 'JAPON' },
  { pgId: 11, home: 'COSTA DE MARFIL', away: 'ECUADOR' },
  { pgId: 12, home: 'SUECIA', away: 'TUNEZ' },
];

const esperado = {
  B4: 5, C1: 6, C6: 7, D5: 8, E3: 9, F1: 10, E4: 11, F6: 12,
};

(async () => {
  const rows = await select('id,home,away&order=kickoff');
  let ok = 0;
  let fail = 0;
  for (const [id, pgId] of Object.entries(esperado)) {
    const partido = rows.find((r) => r.id === id);
    const match = findMatch(partido, candidatos);
    const got = match ? match.pgId : null;
    const status = got === pgId ? 'OK' : 'FAIL';
    if (status === 'OK') ok++; else fail++;
    console.log(`${status}  ${id} (${partido.home} vs ${partido.away}) -> pgId esperado=${pgId} obtenido=${got}`);
  }
  console.log(`\n${ok}/${ok + fail} matches correctos`);
  if (fail > 0) process.exit(1);
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
