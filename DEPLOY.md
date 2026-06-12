# Despliegue en Oracle Cloud (cron diario)

Objetivo: que `refresh.js` corra solo cada día a las **9:00 Bogotá** (= 14:00 UTC) en tu
servidor Oracle, el mismo donde ya corre Evolution. Corre 24/7 aunque tu PC esté apagado.

Necesitas: acceso SSH a tu servidor Oracle (usuario `opc`/`ubuntu` y la IP o dominio).

---

## Paso 1 — Empaquetar el proyecto (en tu PC Windows, PowerShell)

Desde la carpeta del proyecto (`c:\Users\user\Documents\IA\Polla Mundial`):

```powershell
tar --exclude=node_modules --exclude=.git -czf polla.tgz .
```

Esto crea `polla.tgz` (incluye tu `.env` con las credenciales — no lo subas a internet).

## Paso 2 — Copiarlo al servidor

```powershell
# Reemplaza USUARIO y SERVIDOR (ej. opc@123.45.67.89)
scp polla.tgz USUARIO@SERVIDOR:~/
```

## Paso 3 — Conectarte y descomprimir

```bash
ssh USUARIO@SERVIDOR
mkdir -p ~/polla-mundial && tar -xzf ~/polla.tgz -C ~/polla-mundial
cd ~/polla-mundial
```

## Paso 4 — Instalar Node 18+ (solo si no lo tienes)

Comprueba: `node --version`. Si falta o es menor a 18:

**Oracle Linux / RHEL (dnf):**
```bash
sudo dnf module reset nodejs -y
sudo dnf module install nodejs:20 -y
```

**Ubuntu/Debian (apt):**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

## Paso 5 — Desplegar (instala, prueba y registra el cron)

```bash
cd ~/polla-mundial && bash scripts/deploy_oracle.sh
```

El script:
1. Verifica Node ≥ 18 y que exista `.env`.
2. `npm install` (solo runtime: dotenv, pg).
3. Corre una **prueba en seco** (no envía WhatsApp, no escribe BD) — debes ver el mensaje en pantalla.
4. Registra el cron a las **14:00 UTC** y te muestra la línea.

---

## Verificar / operar

```bash
crontab -l                                   # ver el cron registrado
cd ~/polla-mundial && node src/refresh.js --dry-run   # probar a mano sin enviar
cd ~/polla-mundial && node src/refresh.js            # forzar un envío real ahora
tail -f ~/polla-mundial/refresh.log                  # ver los logs en vivo
```

## Notas

- **Zona horaria:** el cron usa **14:00 UTC** = 9:00 Bogotá (Colombia es UTC-5 fijo, sin
  horario de verano), sin importar la TZ del servidor. Para confirmar la hora del server: `date -u`.
- **Actualizar el código** después: repite Pasos 1-3 (sobrescribe), luego
  `cd ~/polla-mundial && npm install --omit=dev`. El cron ya queda; no hay que re-registrarlo.
- **El `.env`** viaja dentro del `.tgz`. Si prefieres no copiarlo, créalo a mano en el server
  con los mismos valores que tienes en tu PC.
- **Apagar temporalmente:** `crontab -e` y comenta (`#`) la línea, o `crontab -r` para quitar todo.
