-- Iniciativa A: registro de trivias respondidas (una sola vez por pregunta).
create table if not exists trivia_log (
  cod           text primary key,     -- CodTrivia: identifica la pregunta (1 respuesta por cod)
  sec           text,                 -- SecTrivia
  fecha         date,
  pregunta      text,
  id_respuesta  text,                 -- opción enviada
  acierto       boolean,              -- true/false/null (si no se pudo detectar)
  respondida_at timestamptz default now()
);
