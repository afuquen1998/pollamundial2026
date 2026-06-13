// Prueba del solver de trivia con preguntas inventadas (Areandina + mundiales).
// Mide latencia. Usa OpenAI (effort low, sin web_search) → costo mínimo.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { solve } = require('../src/lib/triviaSolver');

const PREGUNTAS = [
  { q: '¿En qué año fue fundada la Fundación Universitaria del Área Andina?',
    op: ['1971', '1983', '1995', '2003'], correcta: '1983' },
  { q: '¿En cuál de estas ciudades NO tiene sede o seccional Areandina?',
    op: ['Bogotá', 'Pereira', 'Valledupar', 'Barranquilla'], correcta: 'Barranquilla' },
  { q: '¿Qué país ganó la Copa del Mundo de fútbol de 2014 en Brasil?',
    op: ['Argentina', 'Brasil', 'Alemania', 'España'], correcta: 'Alemania' },
  { q: '¿Quién ganó el Balón de Oro del Mundial 2022 en Catar?',
    op: ['Kylian Mbappé', 'Lionel Messi', 'Luka Modric', 'Antoine Griezmann'], correcta: 'Lionel Messi' },
  { q: '¿Cuál selección ha ganado más Copas del Mundo?',
    op: ['Alemania', 'Italia', 'Brasil', 'Argentina'], correcta: 'Brasil' },
];

(async () => {
  let aciertos = 0; const tiempos = [];
  for (const { q, op, correcta } of PREGUNTAS) {
    const opciones = op.map((texto, i) => ({ id: String(i + 1), texto }));
    try {
      const r = await solve(q, opciones);
      tiempos.push(r.ms);
      const elegida = op[r.indice];
      const ok = elegida === correcta;
      if (ok) aciertos++;
      console.log(`${ok ? '✅' : '❌'} (${(r.ms / 1000).toFixed(1)}s) ${q}\n    eligió: ${elegida}  | esperado: ${correcta}  | razón: ${r.razon}`);
    } catch (e) {
      console.log(`⚠️  ERROR: ${q}\n    ${e.message}`);
    }
  }
  const avg = tiempos.length ? (tiempos.reduce((a, b) => a + b, 0) / tiempos.length / 1000).toFixed(1) : 'n/d';
  const max = tiempos.length ? (Math.max(...tiempos) / 1000).toFixed(1) : 'n/d';
  console.log(`\nResumen: ${aciertos}/${PREGUNTAS.length} aciertos · latencia prom ${avg}s · máx ${max}s (límite duro 20s)`);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
