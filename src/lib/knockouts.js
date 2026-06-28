// Auto-carga de equipos de ELIMINATORIAS desde el fixture oficial.
// Los partidos Kxx (id = "K" + MatchNumber del feed fixturedownload) se crean con
// equipos "Por definir"; el motor los ignora hasta que tengan equipos reales.
// Cada día, refresh.js llama sincronizar(): relee el feed y, para cada Kxx que ya
// tenga equipos definidos en el feed pero siga en placeholder en la BD, los carga.
// Así no depende de que nadie se acuerde de cargarlos a mano.
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { rest, update } = require('./supabase');

const FEED_URL = process.env.FIXTURE_FEED_URL ||
  'https://fixturedownload.com/feed/json/fifa-world-cup-2026';

// Nombres del feed (inglés) -> nombres como están en la BD (español). Cubre los 32
// equipos que llegaron a 16avos; cualquiera que avance usa el mismo nombre del feed.
const MAP_RAW = {
  'South Africa': 'Sudáfrica', 'Canada': 'Canadá', 'Germany': 'Alemania', 'Paraguay': 'Paraguay',
  'Netherlands': 'Países Bajos', 'Morocco': 'Marruecos', 'Brazil': 'Brasil', 'Japan': 'Japón',
  'France': 'Francia', 'Sweden': 'Suecia', "Côte d'Ivoire": 'Costa de Marfil', 'Norway': 'Noruega',
  'Mexico': 'México', 'Ecuador': 'Ecuador', 'England': 'Inglaterra', 'Congo DR': 'RD Congo',
  'USA': 'Estados Unidos', 'Bosnia and Herzegovina': 'Bosnia', 'Belgium': 'Bélgica', 'Senegal': 'Senegal',
  'Portugal': 'Portugal', 'Croatia': 'Croacia', 'Spain': 'España', 'Austria': 'Austria',
  'Switzerland': 'Suiza', 'Algeria': 'Argelia', 'Argentina': 'Argentina', 'Cabo Verde': 'Cabo Verde',
  'Colombia': 'Colombia', 'Ghana': 'Ghana', 'Australia': 'Australia', 'Egypt': 'Egipto',
};

const norm = (s = '') => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z]/g, '');
const MAP = {};
for (const [en, es] of Object.entries(MAP_RAW)) MAP[norm(en)] = es;

const esPlaceholder = (s = '') => /por definir|to be|tbd|tba|winner|loser|runner|ganador|perdedor/i.test(s);
const traducir = (nombre) => (esPlaceholder(nombre) ? null : (MAP[norm(nombre)] || null));

// Relee el feed y carga en la BD los Kxx (knockouts) cuyos equipos ya están
// definidos en el feed pero siguen en placeholder en la BD.
// Devuelve [{id, home, away}] de lo cargado (vacío si no hay nada nuevo).
async function sincronizar({ log = () => {} } = {}) {
  let feed;
  try {
    const res = await fetch(FEED_URL);
    if (!res.ok) throw new Error(`feed HTTP ${res.status}`);
    feed = await res.json();
  } catch (e) {
    log(`knockouts: no pude leer el feed (${e.message}) → omito sync`);
    return [];
  }
  const byNum = {};
  for (const m of feed) byNum[Number(m.MatchNumber)] = m;

  // partidos de la BD con algún equipo "Por definir"
  const ph = await rest('predicciones?select=id,home,away&or=(home.ilike.*definir*,away.ilike.*definir*)');
  const cargados = [];
  for (const r of ph) {
    const num = Number(String(r.id).replace(/\D/g, ''));
    if (!(num >= 73 && num <= 104)) continue; // solo eliminatorias (K73..K104)
    const m = byNum[num];
    if (!m) continue;
    const h = traducir(m.HomeTeam), a = traducir(m.AwayTeam);
    if (!h || !a) continue; // el feed aún no define esta llave, o falta en el MAP
    await update(r.id, { home: h, away: a });
    cargados.push({ id: r.id, home: h, away: a });
    log(`knockouts: ${r.id} cargado → ${h} vs ${a}`);
  }
  return cargados;
}

module.exports = { sincronizar, traducir, FEED_URL };
