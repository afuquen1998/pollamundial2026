# Polla Mundial 2026 — Asistente de refresco con alertas WhatsApp

Script de Node que corre por cron: detecta partidos que se cierran en las próximas 36 h,
recalcula las dos pollas (conservadora y agresiva) con noticias del día vía OpenAI
(`gpt-5` + web_search, Responses API) y avisa por WhatsApp (Evolution API) **qué cambió y por qué**.
Sistema asesor: nunca escribe en la plataforma de la polla — tú decides y cargas manual.

## Estructura

```
seed_predicciones.json   # 72 predicciones iniciales (grupos A–L)
kickoffs.json            # horarios oficiales FIFA (UTC) + estadio, generado del calendario
sql/create_table.sql     # DDL de la tabla `predicciones`
scripts/setup_db.js      # crea la tabla (necesita SUPABASE_DB_URL)
scripts/load_seed.js     # upsert del seed + kickoffs, normalizado a orden FIFA
src/lib/supabase.js      # cliente REST mínimo (service_role)
src/refresh.js           # cerebro: ventana 36h → Anthropic → diff → WhatsApp
```

## Setup

```bash
npm install
cp .env.example .env     # llenar credenciales
npm run setup-db         # crea tabla (o pega sql/create_table.sql en el SQL Editor)
npm run load-seed        # carga las 72 filas
```

## Uso

```bash
npm run refresh:dry      # prueba en seco: todo menos enviar WhatsApp / escribir sugerencias
npm run refresh          # run real
```

## Cron (Oracle Cloud, 9:00 Bogotá = 14:00 UTC)

```cron
0 14 * * * cd /home/ubuntu/polla-mundial && /usr/bin/node src/refresh.js >> refresh.log 2>&1
```

## Notas

- `kickoff` se guarda en UTC; la ventana se calcula contra `now()`, sin líos de zona.
- 31 partidos del seed venían con local/visitante invertido vs el orden oficial FIFA;
  `load_seed.js` los normaliza (equipos y marcadores) para que coincidan con la plataforma.
  Usa `--keep-seed-orientation` si tu plataforma lista los partidos como el seed original.
- Si Claude no devuelve JSON válido se reintenta 1 vez; si vuelve a fallar llega un
  WhatsApp de "revisar manual".
- Partidos con kickoff ya pasado se marcan `cerrado=true` automáticamente en cada run.

## Puntaje de la polla (referencia)

- 6 pts resultado (1/X/2) · +4 marcador exacto · +2 un marcador acertado.
- Perfil **c** (conservadora): máximo valor esperado. Perfil **a** (agresiva): mayor techo.
