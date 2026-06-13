-- Iniciativa B2: snapshot diario del ranking en ambas pollas (para ver tendencia).
create table if not exists ranking_log (
  fecha        date not null,
  plataforma   text not null,        -- 'PG' | 'PF'
  puesto       int,
  puntos       int,
  total        int,
  brecha_lider int,
  brecha_top3  int,
  created_at   timestamptz default now(),
  primary key (fecha, plataforma)     -- 1 snapshot por día y plataforma (upsert)
);
