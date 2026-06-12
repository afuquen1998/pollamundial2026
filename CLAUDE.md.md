# Polla Mundial 2026 — Asistente de refresco con alertas WhatsApp

Brief para construir en Claude Code. Sistema **asesor**: detecta partidos que se cierran pronto, recalcula las dos pollas con noticias del día y te avisa por WhatsApp **qué cambió y por qué**. Tú decides y cargas el pronóstico manualmente en la plataforma. El sistema no escribe en ningún lado por sí solo.

## Decisiones de diseño (ya tomadas)
- Canal: **WhatsApp** vía tu Evolution API (ya corriendo en Oracle Cloud).
- Modo: **alerta + tú decides**. Nunca autoenvía a la polla.
- Plataforma de la polla: **manual** (sin API). El sistema solo lee datos públicos y tu seed.
- Orquestación: **n8n** (self-hosted). Cerebro analítico: **API de Anthropic con la herramienta de web_search activada** (Claude busca lesiones/alineaciones del día solo).

## Por qué "refresco pre-jornada" y no tiempo real
Cada predicción se bloquea ~10 min antes del partido y los partidos llegan en oleadas. Correr una vez al día y filtrar los que se cierran en las próximas ~36 h captura casi todo el valor (caso Davies/Canadá) sin complejidad de streaming.

---

## Arquitectura (flujo n8n)

```
[Cron diario 9:00 COT]
        │
        ▼
[Read predicciones]  ← Supabase (o el seed_predicciones.json en repo)
        │
        ▼
[Filtrar ventana]    → partidos con kickoff en las próximas 36 h y aún no cerrados
        │  (si no hay ninguno → fin)
        ▼
[HTTP → Anthropic /v1/messages]  (web_search ON, devuelve JSON estricto)
        │
        ▼
[Parse + Diff]       → marca changed=true donde la recomendación ≠ predicción actual
        │  (si nada cambió y nada se cierra → fin sin molestar)
        ▼
[Build mensaje WhatsApp]
        │
        ▼
[HTTP → Evolution API /message/sendText]  → tu número
        │
        ▼
[(Opcional) Update predicciones]  → guarda la recomendación como "sugerida" (no aplicada)
```

## Esquema de datos (Supabase, opcional pero recomendado)

```sql
create table predicciones (
  id text primary key,          -- 'A1', 'K1', ...
  grupo text not null,
  home text not null,
  away text not null,
  kickoff timestamptz,          -- completar desde el calendario oficial
  conf text,                    -- Alta | Media | Baja
  c_h int, c_a int,             -- pronóstico conservadora
  a_h int, a_a int,             -- pronóstico agresiva
  cerrado boolean default false -- true cuando ya cargaste / ya jugó
);
```
Carga inicial: importar `seed_predicciones.json` (mapear `c:[h,a]`→`c_h,c_a` y `a:[h,a]`→`a_h,a_a`). Si prefieres cero infra, puedes leer/escribir el JSON directo en el repo o en un Google Sheet.

---

## El cerebro: prompt para la API de Anthropic

`system`:
```
Eres un analista cuantitativo de fútbol de élite. Optimizas predicciones de quiniela
para un sistema de puntaje específico. Respondes SOLO con JSON válido: sin texto extra,
sin markdown, sin explicaciones fuera del JSON.
```

`user` (plantilla; n8n reemplaza {{...}}):
```
SISTEMA DE PUNTAJE (tiempo reglamentario, 90'+adición):
- 6 pts: acertar el resultado (1=gana local / X=empate / 2=gana visitante).
- +4 pts: acertar EXACTAMENTE ambos marcadores.
- +2 pts: acertar UN solo marcador (se otorga aunque falles el resultado).
- Marcadores modales realistas (1-0, 2-1, 2-0, 1-1, 0-0, 3-0) maximizan +2/+4.
- Penaltis NO aplican en fase de grupos.

DOS PERFILES:
- "c" (conservadora): máximo valor esperado → favorito + marcador más probable.
- "a" (agresiva): mayor techo → en partidos parejos toma el lado contrarian/underdog
  con upside; en goleadas claras coincide con la conservadora.

FECHA DE HOY: {{FECHA}}

PARTIDOS QUE SE CIERRAN PRONTO (con su predicción actual):
{{MATCHES_JSON}}
// formato de cada item: {"id","home","away","conf","c":[h,a],"a":[h,a]}

TAREA: Usa la herramienta de búsqueda web para traer lo MÁS reciente sobre estos
equipos: lesiones, suspensiones, alineaciones probables, forma reciente, clima/altitud
y si el partido es intrascendente (equipo ya clasificado o eliminado → riesgo de
rotación). Con esa evidencia, revisa cada predicción.

Devuelve SOLO un array JSON. Un objeto por partido:
{
  "id": "<id>",
  "c": [local, visitante],
  "a": [local, visitante],
  "changed": true|false,        // ¿tu recomendación difiere de la predicción actual?
  "conf": "Alta|Media|Baja",
  "reason": "<motivo en 1 línea; cita el dato nuevo si lo hay>"
}
```

### HTTP node → Anthropic
```
POST https://api.anthropic.com/v1/messages
Headers:
  x-api-key: {{ $env.ANTHROPIC_API_KEY }}
  anthropic-version: 2023-06-01
  content-type: application/json
Body:
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 2000,
  "system": "<system de arriba>",
  "messages": [{ "role": "user", "content": "<user de arriba ya interpolado>" }],
  "tools": [{ "type": "web_search_20250305", "name": "web_search" }]
}
```
`web_search` es una herramienta de servidor: Claude la ejecuta y devuelve la respuesta final. En la respuesta, toma el último bloque `type:"text"` y haz `JSON.parse`. Limpia posibles ```` ```json ```` por si acaso.

---

## Diff + construcción del mensaje (Code node n8n)

```js
const recs = JSON.parse(textoLimpioDeClaude); // array del prompt
const actuales = $('Read predicciones').all().map(r => r.json); // de Supabase/seed
const byId = Object.fromEntries(actuales.map(p => [p.id, p]));

const cambios = recs.filter(r => {
  const p = byId[r.id]; if (!p) return false;
  const dC = r.c[0] !== p.c_h || r.c[1] !== p.c_a;
  const dA = r.a[0] !== p.a_h || r.a[1] !== p.a_a;
  return dC || dA;
});

const linea = r => {
  const p = byId[r.id];
  return `⚽ ${p.home} vs ${p.away}  (${r.conf})\n` +
         `   🛡️ Conservadora: ${r.c[0]}-${r.c[1]}\n` +
         `   🔥 Agresiva: ${r.a[0]}-${r.a[1]}\n` +
         `   ➤ ${r.reason}`;
};

const total = recs.length;
const texto = cambios.length
  ? `🔔 *Polla Mundial 2026* — cierre próximo\n\n` +
    `Se cierran ${total} partidos pronto. Cambios sugeridos: ${cambios.length}\n\n` +
    cambios.map(linea).join('\n\n') +
    `\n\n_Tú decides y lo cargas manual._`
  : `✅ *Polla Mundial 2026*\nSe cierran ${total} partidos pronto y NO hay cambios sugeridos. Carga tus pronósticos actuales.`;

return [{ json: { texto } }];
```

### HTTP node → Evolution API (enviar WhatsApp)
```
POST {{ $env.EVOLUTION_URL }}/message/sendText/{{ $env.EVOLUTION_INSTANCE }}
Headers:
  apikey: {{ $env.EVOLUTION_API_KEY }}
  content-type: application/json
Body:
{
  "number": "{{ $env.MI_NUMERO }}",   // ej. 57XXXXXXXXXX
  "text": "{{ $json.texto }}"
}
```
> Nota: el formato del body cambió entre versiones de Evolution. v2 usa `{ number, text }`; algunas builds usan `{ number, textMessage: { text } }`. Ajusta según tu instancia.

---

## Variables de entorno
```
ANTHROPIC_API_KEY=
EVOLUTION_URL=https://tu-evolution.tu-dominio   # sin slash final
EVOLUTION_API_KEY=
EVOLUTION_INSTANCE=tu_instancia
MI_NUMERO=57XXXXXXXXXX
SUPABASE_URL=           # opcional
SUPABASE_SERVICE_KEY=   # opcional
```

## Calendario
Llena el campo `kickoff` de cada partido con el horario oficial (ISO 8601 con zona, ej. `2026-06-18T19:00:00-05:00`). El nodo "Filtrar ventana" usa eso para no molestarte con partidos lejanos.

---

## Qué pedirle a Claude Code (pégale esto)

> Construye un workflow de n8n (puedo importarlo o lo creo a mano siguiendo tu guía) para un asistente de polla del Mundial. Lee `seed_predicciones.json` (te lo paso), guárdalo en una tabla Supabase `predicciones` con el DDL de este brief. Crea el flujo: cron diario → filtra partidos con kickoff < 36h y cerrado=false → llama a la API de Anthropic (modelo claude-sonnet-4-6, web_search ON) con el prompt de este brief interpolando los partidos de la ventana → parsea el JSON → diff contra la tabla → arma el mensaje con el Code node de este brief → envía por Evolution API a mi WhatsApp. Usa variables de entorno, maneja errores (si Claude no devuelve JSON válido, reintenta una vez y si falla manda un WhatsApp de "revisar manual"), y déjame un botón de ejecución manual además del cron. Empecemos por el esquema Supabase y el script de carga del seed.

## Mejoras futuras (cuando ya funcione lo básico)
- Tracker de puntos: una segunda tabla `resultados(id, h, a)`; un node que calcule tus puntos por polla con el sistema 6/+4/+2 y te mande el resumen "vas X pts conservadora / Y pts agresiva" cada noche.
- Recordatorio de trivia (4 pts c/u + desempate): alerta diaria "responde la trivia de hoy, rápido".
- Botón en el WhatsApp (si tu Evolution soporta botones) para "aplicar sugerencia" y marcar el partido como cerrado.
