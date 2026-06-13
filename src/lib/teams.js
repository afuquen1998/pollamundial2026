// Normalización de nombres de equipos + diccionario de alias entre la BD
// (nombres oficiales FIFA en español, con tildes) y las plataformas externas
// (mayúsculas, sin tildes, a veces abreviadas).

// uppercase, sin acentos, sin puntuación, espacios colapsados.
function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Alias: nombre alternativo normalizado -> nombre canónico normalizado (= norm(home/away de la BD)).
// Solo hace falta listar los casos donde norm() NO basta (difieren en algo más que tildes/mayúsculas).
const ALIAS = {
  // Estados Unidos
  USA: 'ESTADOS UNIDOS',
  'EE UU': 'ESTADOS UNIDOS',
  EEUU: 'ESTADOS UNIDOS',

  // Corea del Sur (K -> C)
  'KOREA DEL SUR': 'COREA DEL SUR',
  KOREA: 'COREA DEL SUR',

  // Chequia / República Checa
  'REPUBLICA CHECA': 'CHEQUIA',
  'REPUB CHECA': 'CHEQUIA',
  'REP CHECA': 'CHEQUIA',

  // Bosnia (y Herzegovina)
  'BOSNIA Y HERZEGOVINA': 'BOSNIA',
  'BOSNIA Y HERZEG': 'BOSNIA',
  'BOSNIA HERZEGOVINA': 'BOSNIA',

  // Catar / Qatar
  QATAR: 'CATAR',

  // Curazao (la ç se normaliza a C, no a Z)
  CURACAO: 'CURAZAO',

  // Países Bajos / Holanda
  HOLANDA: 'PAISES BAJOS',

  // Costa de Marfil
  'COSTA MARFIL': 'COSTA DE MARFIL',

  // Arabia Saudí / Saudita
  'ARABIA SAUDITA': 'ARABIA SAUDI',
  'ARABIA SAUDI': 'ARABIA SAUDI',

  // RD Congo / República Democrática del Congo
  'REP DEM CONGO': 'RD CONGO',
  'REPUBLICA DEMOCRATICA DEL CONGO': 'RD CONGO',
  'CONGO RD': 'RD CONGO',
  'CONGO DEMOCRATICO': 'RD CONGO',

  // Irak / Iraq
  IRAQ: 'IRAK',

  // Nueva Zelanda (Predicción Ganadora la llama "Nueva Zelandia")
  'NUEVA ZELANDIA': 'NUEVA ZELANDA',

  // Irán (Polla Futbolera la llama "RI de Irán", Repúb. Islámica)
  'RI DE IRAN': 'IRAN',

  // Cabo Verde (Polla Futbolera la llama "Islas de Cabo Verde")
  'ISLAS DE CABO VERDE': 'CABO VERDE',

  // Corea del Sur (Polla Futbolera la llama "República de Corea")
  'REPUBLICA DE COREA': 'COREA DEL SUR',
};

// Resuelve un nombre (crudo) a su forma canónica normalizada.
function canon(s) {
  const n = norm(s);
  return ALIAS[n] || n;
}

// Compara dos nombres de equipo aplicando norm() + ALIAS.
function same(a, b) {
  return canon(a) === canon(b);
}

// candidatos: array de objetos con { home, away, ...resto } (nombres tal como
// los expone la plataforma). Devuelve el candidato cuyo par (home,away)
// coincide con partido.home/partido.away, probando también el par invertido
// (algunas plataformas listan local/visitante al revés).
function findMatch(partido, candidatos) {
  const h = canon(partido.home);
  const a = canon(partido.away);
  for (const c of candidatos) {
    const ch = canon(c.home);
    const ca = canon(c.away);
    if ((ch === h && ca === a) || (ch === a && ca === h)) return c;
  }
  return null;
}

module.exports = { norm, canon, same, findMatch, ALIAS };
