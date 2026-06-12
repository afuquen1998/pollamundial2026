FROM node:20-alpine
WORKDIR /app

# Deps primero (mejor cache)
COPY package*.json ./
RUN npm install --omit=dev --no-fund --no-audit

# Código
COPY . .

# Proceso siempre activo: el scheduler dispara refresh.js a la hora programada.
CMD ["node", "src/scheduler.js"]
