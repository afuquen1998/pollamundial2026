// Prompt del cerebro. CAMBIO CLAVE para la consistencia: el modelo NO inventa un
// marcador (eso variaba en cada corrida). Solo recolecta datos y estima los GOLES
// ESPERADOS de cada equipo (lambda), una cantidad continua y estable anclada a las
// cuotas del mercado. El marcador óptimo lo calcula un motor determinista aparte
// (src/lib/scoring.js). Separar "recolectar datos" de "calcular el marcador" es lo
// que elimina los 3-marcadores-distintos para el mismo partido.

const SYSTEM =
  'Eres un modelo cuantitativo de fútbol. Tu trabajo es estimar GOLES ESPERADOS ' +
  '(xG prospectivo) de cada equipo, NO inventar un marcador: del marcador óptimo se ' +
  'encarga un motor determinista aparte. Anclas tus estimaciones a las cuotas reales ' +
  'del mercado de apuestas y al rendimiento reciente; eres estable y reproducible: ' +
  'ante la misma evidencia, das los mismos números. Respondes SOLO con JSON válido: ' +
  'sin texto extra, sin markdown, sin nada fuera del JSON.';

// rows: filas de `predicciones` (orden FIFA). fecha: ISO del día (zona Bogotá).
function buildUser(rows, fecha) {
  const matches = rows.map((p) => ({ id: p.id, home: p.home, away: p.away }));

  return `FECHA DE HOY: ${fecha}

PARTIDOS A ANALIZAR:
${JSON.stringify(matches)}
// formato: {"id","home","away"}  — "home" es el local segun orden FIFA

TAREA — para CADA partido, en dos pasos:

1) RECOLECTA con búsqueda web lo MÁS reciente y cruza varias fuentes:
   - Cuotas 1X2 de casas de apuestas (Bet365/Pinnacle/etc.) → el dato más predictivo.
   - Línea de goles totales (Over/Under) si la encuentras.
   - Lesiones, suspensiones y alineación probable (¿falta un goleador/figura?).
   - Forma reciente (últimos ~5) y goles a favor/en contra.
   - Trascendencia: ¿algún equipo ya clasificó o quedó eliminado? → riesgo de rotación
     y partido de bajo ritmo (baja los goles esperados).
   - Clima/altitud si es relevante (p. ej. sedes de altura en México).

2) ESTIMA los goles esperados de cada equipo para ESTE partido, coherentes con las
   cuotas del mercado (no con tu intuición): un favorito claro va ~1.8-2.4; un equipo
   débil ~0.4-0.9; parejos ~1.1-1.4 cada uno. Ajusta por lesiones/rotación/altitud.
   Redondea a 1 decimal. Sé conservador y reproducible.

Devuelve SOLO un array JSON. Un objeto por partido, EXACTAMENTE así:
{
  "id": "<id>",
  "lh": 1.8,        // goles esperados del LOCAL (number, 1 decimal)
  "la": 0.9,        // goles esperados del VISITANTE (number, 1 decimal)
  "odds": {"1": 0.55, "X": 0.25, "2": 0.20},  // prob. implícita 1X2 SIN vig si la hallas; si no, null
  "conf": "Alta",   // confianza en los DATOS recolectados: Alta|Media|Baja
  "trascendente": true,  // false si hay riesgo de rotación (ya clasificado/eliminado)
  "facts": "1 línea: cita los 2-3 datos que más pesan (cuota, lesión, forma). Sin markdown."
}`;
}

module.exports = { SYSTEM, buildUser };
