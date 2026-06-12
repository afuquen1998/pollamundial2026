#!/usr/bin/env bash
# Despliegue en Oracle: instala deps, prueba y registra el cron. Idempotente.
# Correr DENTRO del directorio del proyecto en el servidor:
#   cd ~/polla-mundial && bash scripts/deploy_oracle.sh
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

# 1. Node >= 18 (necesario para fetch global)
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node no está instalado. Instálalo primero (ver DEPLOY.md)."; exit 1
fi
NODE_BIN="$(command -v node)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "ERROR: Node $NODE_MAJOR detectado; se requiere >= 18 (fetch global)."; exit 1
fi
echo "Node OK: $(node --version) en $NODE_BIN"

# 2. .env presente
if [ ! -f "$DIR/.env" ]; then
  echo "ERROR: falta $DIR/.env — cópialo desde tu PC (ver DEPLOY.md)."; exit 1
fi

# 3. Dependencias (solo runtime)
echo "Instalando dependencias..."
npm install --omit=dev --no-fund --no-audit

# 4. Prueba en seco (no envía WhatsApp, no escribe BD)
echo "Prueba en seco..."
node src/refresh.js --dry-run

# 5. Registrar cron: 14:00 UTC = 9:00 America/Bogota (UTC-5, sin DST)
CRON_LINE="0 14 * * * cd $DIR && $NODE_BIN src/refresh.js >> $DIR/refresh.log 2>&1"
( crontab -l 2>/dev/null | grep -vF "$DIR/src/refresh.js" ; echo "$CRON_LINE" ) | crontab -
echo "Cron registrado:"
crontab -l | grep "$DIR/src/refresh.js"

echo
echo "✅ Listo. Corre todos los días 9:00 Bogotá. Logs en $DIR/refresh.log"
echo "   Ejecución manual:        cd $DIR && node src/refresh.js"
echo "   Prueba sin enviar:       cd $DIR && node src/refresh.js --dry-run"
