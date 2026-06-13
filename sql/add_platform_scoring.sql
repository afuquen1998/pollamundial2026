-- Iniciativa B1: puntaje por plataforma.
-- Las dos pollas puntúan distinto, así que el marcador óptimo puede diferir.
-- sug_c_*/sug_a_* (ya existentes) = óptimo de Predicción Ganadora (PG, aditivo).
-- sug_pf_* = óptimo de Polla Futbolera (PF, escalonado).
-- c_*/pub_c_* (ya existentes) = marcador cargado en PG; c_pf_* = cargado en PF.
alter table predicciones
  add column if not exists sug_pf_c_h int,   -- PF seguro (conservador) local
  add column if not exists sug_pf_c_a int,   -- PF seguro visitante
  add column if not exists sug_pf_a_h int,   -- PF arriesgado local
  add column if not exists sug_pf_a_a int,   -- PF arriesgado visitante
  add column if not exists c_pf_h     int,   -- marcador cargado en Polla Futbolera (local)
  add column if not exists c_pf_a     int;   -- marcador cargado en Polla Futbolera (visitante)

-- Backfill: hasta hoy se cargaba el MISMO marcador en ambas pollas → el cargado en
-- PF es igual al de PG (c_h/c_a). Inicializa c_pf_* con eso para no perder el estado.
update predicciones set c_pf_h = c_h where c_pf_h is null and c_h is not null;
update predicciones set c_pf_a = c_a where c_pf_a is null and c_a is not null;
