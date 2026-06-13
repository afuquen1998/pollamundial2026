# Imagen oficial de Playwright (incluye Chromium ya instalado, versión alineada
# con la dependencia "playwright" del package.json).
FROM mcr.microsoft.com/playwright:v1.60.0-noble
WORKDIR /app

# Deps primero (mejor cache). El postinstall de playwright reutiliza los
# navegadores ya presentes en /ms-playwright (misma versión), no descarga de nuevo.
COPY package*.json ./
RUN npm install --omit=dev --no-fund --no-audit

# Código
COPY . .

# Proceso siempre activo: server.js levanta el cron (refresh.js a las 9am) y el
# servidor HTTP (GET /health, POST /webhook/:token).
CMD ["node", "src/server.js"]
