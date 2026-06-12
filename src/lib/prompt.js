// Construye el system y el user prompt del brief, interpolando los partidos de la ventana.

const SYSTEM =
  'Eres un analista cuantitativo de fútbol de élite. Optimizas predicciones de quiniela ' +
  'para un sistema de puntaje específico. Respondes SOLO con JSON válido: sin texto extra, ' +
  'sin markdown, sin explicaciones fuera del JSON.';

// rows: filas de `predicciones` (orden FIFA). fecha: ISO del día (zona Bogotá).
function buildUser(rows, fecha) {
  const matches = rows.map((p) => ({
    id: p.id,
    home: p.home,
    away: p.away,
    conf: p.conf,
    c: [p.c_h, p.c_a],
    a: [p.a_h, p.a_a],
  }));

  return `SISTEMA DE PUNTAJE (tiempo reglamentario, 90'+adición):
- 6 pts: acertar el resultado (1=gana local / X=empate / 2=gana visitante).
- +4 pts: acertar EXACTAMENTE ambos marcadores.
- +2 pts: acertar UN solo marcador (se otorga aunque falles el resultado).
- Marcadores modales realistas (1-0, 2-1, 2-0, 1-1, 0-0, 3-0) maximizan +2/+4.
- Penaltis NO aplican en fase de grupos.

DOS PERFILES:
- "c" (conservadora): máximo valor esperado → favorito + marcador más probable.
- "a" (agresiva): mayor techo → en partidos parejos toma el lado contrarian/underdog
  con upside; en goleadas claras coincide con la conservadora.

FECHA DE HOY: ${fecha}

PARTIDOS QUE SE CIERRAN PRONTO (con su predicción actual):
${JSON.stringify(matches)}
// formato de cada item: {"id","home","away","conf","c":[h,a],"a":[h,a]}

TAREA: Usa la herramienta de búsqueda web para traer lo MÁS reciente sobre estos
equipos: lesiones, suspensiones, alineaciones probables, forma reciente, clima/altitud
y si el partido es intrascendente (equipo ya clasificado o eliminado → riesgo de
rotación). Con esa evidencia, revisa cada predicción.

Devuelve SOLO un array JSON. Un objeto por partido:
{
  "id": "<id>",
  "c": [local, visitante],
  "a": [local, visitante],
  "changed": true|false,
  "conf": "Alta|Media|Baja",
  "reason": "<motivo en 1 línea; cita el dato nuevo si lo hay>"
}`;
}

module.exports = { SYSTEM, buildUser };
