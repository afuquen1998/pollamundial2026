// Motor DETERMINISTA para fijar marcadores. Sin LLM → mismas entradas, misma salida.
//
// Idea clave (mata la inconsistencia): el LLM NO inventa un marcador. Solo estima
// los goles esperados de cada equipo (lambda local, lambda visitante), una cantidad
// continua y estable anclada a las cuotas del mercado. Este motor calcula con un
// modelo de Poisson el marcador que MAXIMIZA los puntos de la polla. Como el cálculo
// es pura matemática, dos corridas con lambdas parecidas dan el MISMO marcador.
//
// ⚠️ LAS DOS POLLAS PUNTÚAN DISTINTO (confirmado en sus instrucciones, FASE 0):
//
//   PG = Predicción Ganadora (ADITIVO, exacto = 10):
//     6  acertar el resultado (1 / X / 2)
//     +4 acertar EXACTAMENTE ambos marcadores
//     +2 acertar UN solo marcador (aunque falles el resultado)
//     → marcador exacto = 6+4 = 10 pts (el jackpot que gana pollas)
//
//   PF = Polla Futbolera (tabla real del reglamento, confirmada y despejada de la
//        tabla de posiciones 2026-06-26: Pts = 6·ME + 4·AR + 2·ML + 2·MV, donde la
//        columna AR cuenta SOLO los resultados que NO fueron exactos):
//     6  marcador exacto (nivel; EXCLUYENTE con "resultado")
//     4  resultado del partido (1/X/2) cuando NO es exacto
//     2  goles del equipo LOCAL acertados   (se suman aparte, también en exactos)
//     2  goles del equipo VISITANTE acertados
//     → clavar el exacto = 6 + 2 + 2 = 10 pts (igual que PG). El exacto paga MUCHO.
//       Como el "resultado" pesa menos que en PG (4 vs 6), arriesgar al exacto rinde
//       relativamente MÁS en PF. El óptimo tiende al modal exacto del favorito.
//       (Antes se creía escalonado/máx 6 → era un error que subvaloraba arriesgar.)
//
// Casi todo el motor (matriz Poisson, top-3, 1X2) es genérico; solo cambia la
// FUNCIÓN DE PUNTAJE de un marcador según el sistema. analyze/ev/evOf reciben
// `sistema` ('PG' por defecto = comportamiento histórico).

const MAXG = 7; // goles máx por equipo en la distribución

// P(X=k) con X ~ Poisson(lambda)
function poissonPmf(lambda, k) {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

// Matriz conjunta de marcadores [h][a], h,a en 0..MAXG. Goles de cada equipo
// independientes (Poisson). La cola más allá de MAXG se renormaliza dentro.
function jointMatrix(lh, la) {
  const ph = [], pa = [];
  for (let i = 0; i <= MAXG; i++) { ph.push(poissonPmf(lh, i)); pa.push(poissonPmf(la, i)); }
  const sh = ph.reduce((x, y) => x + y, 0);
  const sa = pa.reduce((x, y) => x + y, 0);
  const M = [];
  for (let h = 0; h <= MAXG; h++) {
    M[h] = [];
    for (let a = 0; a <= MAXG; a++) M[h][a] = (ph[h] / sh) * (pa[a] / sa);
  }
  return M;
}

const outcome = (h, a) => (h > a ? '1' : h < a ? '2' : 'X');

// Probabilidad de cada resultado 1 / X / 2 a partir de la matriz.
function outcomeProbs(M) {
  const r = { '1': 0, X: 0, '2': 0 };
  for (let h = 0; h <= MAXG; h++)
    for (let a = 0; a <= MAXG; a++) r[outcome(h, a)] += M[h][a];
  return r;
}

// Puntos que da PREDECIR (ph,pa) cuando el resultado REAL es (h,a), según el sistema.
//   PG = aditivo (6 resultado +4 exacto +2 un dígito → exacto 10)
//   PF = escalonado (mejor acierto: 6 exacto / 4 resultado / 2 goles de un equipo / 0)
function puntosPred(ph, pa, h, a, sistema = 'PG') {
  const exact = h === ph && a === pa;
  const res = outcome(h, a) === outcome(ph, pa);
  const one = (h === ph) !== (a === pa); // exactamente un dígito coincide
  if (sistema === 'PF') {
    // exacto(6) y resultado(4) son EXCLUYENTES; los goles de cada equipo (2+2)
    // se suman aparte (también cuando el marcador es exacto).
    let p = 0;
    if (exact) p += 6;       // marcador exacto
    else if (res) p += 4;    // resultado sin ser exacto
    if (h === ph) p += 2;    // goles del local
    if (a === pa) p += 2;    // goles del visitante
    return p;                // exacto = 6+2+2 = 10
  }
  // PG (aditivo, por defecto)
  let p = 0;
  if (res) p += 6;
  if (exact) p += 4;
  else if (one) p += 2;
  return p;
}

// Puntos ESPERADOS de PREDECIR el marcador (ph,pa) bajo el sistema de la polla.
function ev(M, ph, pa, sistema = 'PG') {
  let s = 0;
  for (let h = 0; h <= MAXG; h++)
    for (let a = 0; a <= MAXG; a++)
      s += M[h][a] * puntosPred(ph, pa, h, a, sistema);
  return s;
}

// Probabilidad de acertar el marcador EXACTO (ph,pa).
const exactProb = (M, ph, pa) => M[ph][pa];

// Analiza un partido desde sus goles esperados PARA UN SISTEMA de puntaje.
// Devuelve marcador conservador (máx EV bajo ese sistema), arriesgado (máx prob de
// exacto, distinto del conservador), top-3 marcadores más probables y las probs 1X2.
function analyze(lh, la, sistema = 'PG', maxPred = 5) {
  const M = jointMatrix(lh, la);
  const probs = outcomeProbs(M);
  const cands = [];
  for (let h = 0; h <= maxPred; h++)
    for (let a = 0; a <= maxPred; a++)
      cands.push({ h, a, ev: ev(M, h, a, sistema), pExact: M[h][a], outcome: outcome(h, a) });

  const byEv = [...cands].sort((x, y) => y.ev - x.ev || y.pExact - x.pExact);
  const byExact = [...cands].sort((x, y) => y.pExact - x.pExact);

  const conservative = byEv[0];
  // Arriesgado: marcador exacto más probable que NO sea el conservador (un swing real).
  const aggressive =
    byExact.find((c) => !(c.h === conservative.h && c.a === conservative.a)) || byExact[0];
  const top3 = byExact.slice(0, 3);

  return { sistema, lambda: [lh, la], probs, conservative, aggressive, top3 };
}

// EV de un marcador concreto (para evaluar el pronóstico ya cargado por el usuario).
const evOf = (lh, la, h, a, sistema = 'PG') => ev(jointMatrix(lh, la), h, a, sistema);

module.exports = { jointMatrix, outcomeProbs, ev, evOf, exactProb, puntosPred, analyze, outcome, MAXG };
