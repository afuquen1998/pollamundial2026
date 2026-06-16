-- Fix: el 'cod' de la trivia es ESTÁTICO (siempre 13), no identifica el día.
-- La unicidad real es POR DÍA (1 respuesta/día). Cambiamos la clave de cod → fecha.
alter table trivia_log drop constraint if exists trivia_log_pkey;
create unique index if not exists trivia_log_fecha_key on trivia_log (fecha);
