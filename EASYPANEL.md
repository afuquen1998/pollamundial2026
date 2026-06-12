# Despliegue en Easypanel (app siempre activa, 24/7)

El asistente se despliega como **una app más** en tu Easypanel, al lado de Evolution.
Lleva un cron interno (`scheduler.js`) que dispara el refresh cada día a las **9:00 Bogotá**.
No depende de tu PC. Las credenciales van en el panel (Environment), nunca en el código.

## Resumen del flujo
1. Subir el código a un repositorio de **GitHub** (privado).
2. En Easypanel: crear una **App** que apunte a ese repo (Easypanel construye con el `Dockerfile`).
3. Pegar las credenciales en **Environment**.
4. **Deploy**. Listo: corre solo todos los días.

---

## Paso 1 — Código en GitHub
- Crea una cuenta en github.com (gratis) si no tienes.
- Crea un repositorio **privado** vacío, ej. `polla-mundial-2026`.
- Sube el contenido de esta carpeta **EXCEPTO** `.env`, `node_modules` y `*.tgz`
  (el `.gitignore` ya los excluye si usas git).

## Paso 2 — Crear la App en Easypanel
1. Abre tu Easypanel → entra al **Project** (donde está Evolution) o crea uno nuevo.
2. **+ Service** → **App**.
3. Nombre: `polla-mundial`.
4. En **Source** → **GitHub** → conecta tu cuenta y selecciona el repo `polla-mundial-2026`,
   rama `main`. (Easypanel detecta el `Dockerfile` y construye solo.)

## Paso 3 — Environment (las credenciales)
En la pestaña **Environment** de la app, pega EXACTAMENTE estas variables con TUS valores
(los mismos de tu archivo `.env` local):

```
OPENAI_API_KEY=<tu key de OpenAI>
OPENAI_MODEL=gpt-5

EVOLUTION_URL=<tu url de Evolution, sin / final>
EVOLUTION_API_KEY=<tu apikey global de Evolution>
EVOLUTION_INSTANCE=<nombre de tu instancia>
MI_NUMERO=<tu número con indicativo, sin +>

SUPABASE_URL=<tu Project URL de Supabase>
SUPABASE_SERVICE_KEY=<tu service_role key>

WINDOW_HOURS=36
EVOLUTION_BODY_STYLE=v2

CRON_SCHEDULE=0 9 * * *
CRON_TZ=America/Bogota
```

> Copia los valores reales de tu archivo `.env` local (ahí los tienes). No los subas al repo.

> Nota: `SUPABASE_DB_URL` y `SUPABASE_DB_PASSWORD` NO se necesitan aquí (solo se usaban
> para crear la tabla, que ya existe). El refresh usa Supabase por REST.

## Paso 4 — Deploy y verificar
1. Click **Deploy**. Espera a que termine el build (1-2 min).
2. Ve a **Logs** de la app. Debes ver:
   `[scheduler] activo. Programado "0 9 * * *" (America/Bogota). Esperando la hora...`
3. **Probar sin esperar a mañana:** en Environment agrega temporalmente `RUN_ON_START=true`
   y vuelve a deployar → dispara un refresh de inmediato (te llega WhatsApp). Luego quita
   esa variable para que solo corra en el horario.

## Operar
- **Logs:** pestaña Logs de la app.
- **Forzar un envío ahora:** pon `RUN_ON_START=true` y redeploy (quítalo después), o usa la
  **Console** de la app y corre `node src/refresh.js`.
- **Pausar:** apaga (Stop) la app desde Easypanel.
- **Cambiar la hora:** edita `CRON_SCHEDULE` (formato cron, en `CRON_TZ`). Ej. 8am = `0 8 * * *`.

## Actualizar el código después
Haz push a GitHub. Si activaste **Auto Deploy** en la app, Easypanel redespliega solo.
Si no, entra a la app y dale **Deploy**.
