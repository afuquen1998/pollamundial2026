-- Tabla principal de predicciones (DDL del brief + columnas de sugerencia y metadata)
create table if not exists predicciones (
  id text primary key,            -- 'A1', 'K1', ...
  grupo text not null,
  home text not null,             -- orientación oficial FIFA
  away text not null,
  kickoff timestamptz,            -- UTC, del calendario oficial
  location text,                  -- estadio
  conf text,                      -- Alta | Media | Baja
  c_h int, c_a int,               -- pronóstico conservadora
  a_h int, a_a int,               -- pronóstico agresiva
  cerrado boolean default false,  -- true cuando ya cargaste / ya jugó

  -- última sugerencia del refresco (NO aplicada; tú decides)
  sug_c_h int, sug_c_a int,
  sug_a_h int, sug_a_a int,
  sug_conf text,
  sug_reason text,
  sug_at timestamptz
);
