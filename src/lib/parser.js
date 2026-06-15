// Parser de comandos de WhatsApp (§7 PLAN_AUTOCARGA.md).
// Case-insensitive, tolerante a acentos y espacios extra.

function normalizar(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Devuelve uno de:
//   { type: 'ayuda' }
//   { type: 'todos', tipo: 'seguro'|'arriesgado' }
//   { type: 'partido', id: 'A6', tipo: 'seguro'|'arriesgado'|'mantener'|'<h>-<a>', target: 'futbolera'|'prediccion'|'ambas'|null }
//   null  -- no reconocido
function parseComando(texto) {
  const t = normalizar(texto);
  if (!t) return null;

  if (t === 'ayuda' || t === 'help' || t === 'ayuda?') return { type: 'ayuda' };

  // "postura" (opcionalmente seguido de una palabra) → muestra puesto + postura sugerida.
  if (/^postura\b/.test(t)) return { type: 'postura' };

  // "trivia" → dispara el intento de responder la trivia de hoy en el acto.
  if (/^trivia\b/.test(t)) return { type: 'trivia' };

  let m = t.match(/^todos\s+(seguro|arriesgado)$/);
  if (m) return { type: 'todos', tipo: m[1] };

  m = t.match(/^([a-z]\d{1,3})\s+(seguro|arriesgado|mantener|dejar|\d+\s*-\s*\d+)(?:\s+(futbolera|prediccion|ambas))?$/);
  if (m) {
    const id = m[1].toUpperCase();
    let tipo = m[2].replace(/\s+/g, '');
    if (tipo === 'dejar') tipo = 'mantener';
    const target = m[3] || null; // null = usar PUBLISH_DEFAULT_TARGET
    return { type: 'partido', id, tipo, target };
  }

  return null;
}

const AYUDA = [
  '✍️ Cómo responder:',
  '• "A6 seguro"  → carga la opción segura (el mejor marcador para CADA polla)',
  '• "A6 arriesgado" → carga la opción arriesgada',
  '• "A6 2-1"     → carga ese marcador',
  '• "A6 dejar"   → no cambia nada',
  'Agrega "futbolera" o "prediccion" al final si quieres una sola web (si no, van las dos).',
  '"todos seguro" o "todos arriesgado" carga esa opción en todos los partidos de hoy.',
  '• "postura" → te digo en qué puesto vas y qué conviene (atacar/proteger/equilibrado).',
  '• "trivia" → respondo la trivia de hoy ya mismo (si está activa).',
].join('\n');

module.exports = { parseComando, normalizar, AYUDA };
