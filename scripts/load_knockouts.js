// Pre-carga los 32 partidos de ELIMINATORIAS del Mundial 2026 en la tabla `predicciones`.
// Trae fecha/hora/sede del feed oficial (fixturedownload). Los equipos quedan como
// "Por definir" porque aún no se sabe quién avanza; el cerebro (refresh.js) IGNORA los
// partidos con equipos "Por definir", así que estas filas quedan dormidas hasta que, al
// terminar los grupos, actualicemos los equipos reales (un UPDATE por partido).
//
// Uso: node scripts/load_knockouts.js
const { upsert, select } = require('../src/lib/supabase');

const FEED = 'https://fixturedownload.com/feed/json/fifa-world-cup-2026';

// RoundNumber del feed → etiqueta de fase (en español).
const fase = (round, matchNo) => {
  if (round === 4) return '16avos';
  if (round === 5) return 'Octavos';
  if (round === 6) return 'Cuartos';
  if (round === 7) return 'Semifinal';
  if (round === 8) return matchNo === 104 ? 'Final' : '3er puesto';
  return 'Eliminatoria';
};

async function main() {
  const res = await fetch(FEED);
  const all = await res.json();
  const ko = all.filter((m) => m.RoundNumber >= 4); // 1-3 = fase de grupos

  const rows = ko.map((m) => ({
    id: `K${m.MatchNumber}`, // K73..K104, únicos y ordenables
    grupo: fase(m.RoundNumber, m.MatchNumber),
    home: 'Por definir',
    away: 'Por definir',
    kickoff: m.DateUtc ? m.DateUtc.replace(' ', 'T') : null, // "2026-07-19 19:00:00Z" → ISO
    location: m.Location || null,
    conf: null,
    c_h: null, c_a: null, a_h: null, a_a: null,
    cerrado: false,
  }));

  await upsert(rows);
  const all2 = await select('select=id&order=id');
  console.log(`Eliminatorias cargadas: ${rows.length} (K${ko[0].MatchNumber}..K${ko[ko.length - 1].MatchNumber}).`);
  console.log(`Filas totales en tabla: ${all2.length} (72 grupos + 32 eliminatorias = 104).`);
  console.log('Primeros 16avos:', rows.slice(0, 2).map((r) => `${r.id} ${r.grupo} ${r.kickoff} ${r.location}`).join(' | '));
  console.log('Final:', rows.filter((r) => r.grupo === 'Final').map((r) => `${r.id} ${r.kickoff} ${r.location}`).join(''));
  console.log('\nRecuerda: cuando terminen los grupos, actualiza home/away/c/a de cada Kxx con los equipos reales.');
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
