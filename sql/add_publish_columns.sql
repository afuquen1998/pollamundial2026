-- Fase 4: columnas para cache de IDs y registro de publicación por plataforma
alter table predicciones
  add column if not exists pf_match_id text,        -- id interno Polla Futbolera (cache opcional)
  add column if not exists pg_match_id text,        -- id interno Predicción Ganadora (cache opcional)
  add column if not exists pub_pf_at    timestamptz, -- cuándo se cargó en Polla Futbolera
  add column if not exists pub_pg_at    timestamptz, -- cuándo se cargó en Predicción Ganadora
  add column if not exists pub_c_h      int,         -- marcador efectivamente cargado (local)
  add column if not exists pub_c_a      int;         -- marcador efectivamente cargado (visitante)
