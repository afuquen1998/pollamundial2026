// Iniciativa B3: postura sugerida según el puesto y cuántos partidos quedan.
// Solo SUGIERE; la decisión final (seguro/arriesgado por partido) sigue siendo del usuario.
//
// PROTEGER  → vas 1.º y quedan pocos partidos: minimiza varianza (todo SEGURA).
// EQUILIBRADO → top 3 con brecha chica: SEGURA + alguna ARRIESGADA selectiva.
// ATACAR    → fuera del top 3 / brecha grande: busca puntos (cazar exactos en PG;
//             resultados a contracorriente en PF, donde el exacto paga poco).
// CONSTRUIR → aún faltan muchos partidos: juega lo óptimo (SEGURA casi siempre),
//             no regales puntos; ya habrá tiempo de atacar o proteger.

function sugerir(plat, restantes) {
  const top3 = !!plat.enTop3;
  const lider = plat.miPuesto === 1;
  let nombre;
  if (restantes <= 6 && lider) nombre = 'PROTEGER';
  else if (restantes <= 12 && !top3) nombre = 'ATACAR';
  else if (restantes >= 25) nombre = 'CONSTRUIR';
  else if (top3) nombre = 'EQUILIBRADO';
  else nombre = 'ATACAR';

  const esPF = plat.plataforma === 'PF';
  const notaPF = esPF
    ? ' En esta polla el exacto paga poco (6 vs 4 del resultado): arriesgar = elegir resultados a contracorriente, no marcadores raros.'
    : ' En esta polla clavar el exacto vale 10 pts: sí vale cazar marcadores exactos.';

  const explica = {
    PROTEGER: 'Vas 1.º y quedan pocos partidos: juega SEGURA en todo y minimiza riesgos para conservar la punta.',
    EQUILIBRADO: 'Estás en el top 3 con poca brecha: SEGURA como base y alguna ARRIESGADA selectiva para recortar.',
    ATACAR: 'Estás fuera del top 3 y se acaba el tiempo: busca puntos asumiendo más riesgo.' + notaPF,
    CONSTRUIR: 'Aún faltan muchos partidos: juega lo óptimo (SEGURA casi siempre) y no regales puntos. Más adelante ajustamos a ATACAR o PROTEGER según tu puesto.',
  }[nombre];

  return { nombre, explica };
}

// Construye el bloque de texto "Tu situación hoy" + postura sugerida por plataforma.
// `plats` = [resultadoPG|null, resultadoPF|null] (de ranking.posicionesPG/PF).
function bloque(plats, restantes) {
  const find = (sigla) => plats.find((x) => x && x.plataforma === sigla);
  const pg = find('PG'), pf = find('PF');
  const linPos = (p, nombre) => p
    ? `• ${nombre}: vas #${p.miPuesto} de ${p.total} · ${p.miPuntos} pts · a ${p.brechaAlLider} del 1.º` +
      (p.enTop3 ? ' (¡en top 3!)' : `, a ${p.brechaAlTop3} del top 3`)
    : `• ${nombre}: no pude leer tu posición ahora.`;

  const lines = ['🏁 *Tu situación hoy:*', linPos(pg, 'Predicción Ganadora'), linPos(pf, 'Polla Futbolera')];

  const items = [[pg, 'Predicción Ganadora'], [pf, 'Polla Futbolera']]
    .filter(([p]) => p)
    .map(([p, nombre]) => ({ nombre, s: sugerir(p, restantes) }));

  if (items.length === 2 && items[0].s.nombre === items[1].s.nombre && items[0].s.explica === items[1].s.explica) {
    // misma postura en ambas (caso común en fase de grupos) → una sola línea.
    lines.push('📐 *Postura sugerida (ambas pollas):* ' + `*${items[0].s.nombre}* — ${items[0].s.explica}`);
  } else if (items.length) {
    lines.push('📐 *Postura sugerida:*', ...items.map((it) => `• ${it.nombre}: *${it.s.nombre}* — ${it.s.explica}`));
  }
  return lines.join('\n');
}

module.exports = { sugerir, bloque };
