-- Guarda el HTML crudo de la pregunta para depurar el parser tras el primer envío real.
alter table trivia_log add column if not exists html text;
