// Motor DETERMINISTA para fijar marcadores. Sin LLM → mismas entradas, misma salida.
//
// Idea clave (mata la inconsistencia): el LLM NO inventa un marcador. Solo estima
// los goles esperados de cada equipo (lambda local, lambda visitante), una cantidad
// continua y estable anclada a las cuotas del mercado. Este motor calcula con un
// modelo de Poisson el marcador que MAXIMIZA los puntos de la polla. Como el cálculo
// es pura matemática, dos corridas con lambdas parecidas dan el MISMO marcador.
//
// Sistema de puntaje de la polla (tiempo reglamentario):
//   6  acertar el resultado (1 / X / 2)
//   +4 acertar EXACTAMENTE ambos marcadores
//   +2 acertar UN solo marcador (aunque falles el resultado)
//   → marcador exacto = 6+4 = 10 pts (el jackpot que gana pollas)

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

// Puntos ESPERADOS de PREDECIR el marcador (ph,pa) bajo el sistema de la polla.
function ev(M, ph, pa) {
  const po = outcome(ph, pa);
  let pOut = 0, pExact = 0, pOne = 0;
  for (let h = 0; h <= MAXG; h++) {
    for (let a = 0; a <= MAXG; a++) {
      const v = M[h][a];
      if (outcome(h, a) === po) pOut += v;
      const hMatch = h === ph, aMatch = a === pa;
      if (hMatch && aMatch) pExact += v;
      else if (hMatch !== aMatch) pOne += v; // exactamente un dígito
    }
  }
  return 6 * pOut + 4 * pExact + 2 * pOne;
}

// Probabilidad de acertar el marcador EXACTO (ph,pa).
const exactProb = (M, ph, pa) => M[ph][pa];

// Analiza un partido desde sus goles esperados.
// Devuelve marcador conservador (máx EV), arriesgado (máx prob de exacto, distinto
// del conservador), top-3 marcadores más probables y las probabilidades 1X2.
function analyze(lh, la, maxPred = 5) {
  const M = jointMatrix(lh, la);
  const probs = outcomeProbs(M);
  const cands = [];
  for (let h = 0; h <= maxPred; h++)
    for (let a = 0; a <= maxPred; a++)
      cands.push({ h, a, ev: ev(M, h, a), pExact: M[h][a], outcome: outcome(h, a) });

  const byEv = [...cands].sort((x, y) => y.ev - x.ev || y.pExact - x.pExact);
  const byExact = [...cands].sort((x, y) => y.pExact - x.pExact);

  const conservative = byEv[0];
  // Arriesgado: marcador exacto más probable que NO sea el conservador (un swing real).
  const aggressive =
    byExact.find((c) => !(c.h === conservative.h && c.a === conservative.a)) || byExact[0];
  const top3 = byExact.slice(0, 3);

  return { lambda: [lh, la], probs, conservative, aggressive, top3 };
}

// EV de un marcador concreto (para evaluar el pronóstico ya cargado por el usuario).
const evOf = (lh, la, h, a) => ev(jointMatrix(lh, la), h, a);

module.exports = { jointMatrix, outcomeProbs, ev, evOf, exactProb, analyze, outcome, MAXG };
