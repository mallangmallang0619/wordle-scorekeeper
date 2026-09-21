FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist/src ./dist
# SQLite lives on a volume so redeploys don't lose data
ENV WORDLE_DB=/data/wordle.sqlite3
VOLUME ["/data"]
CMD ["node", "dist/bot.js"]
