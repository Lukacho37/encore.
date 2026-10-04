# Image de production d'AlbumMania (Railway, Fly.io, un VPS… ou Render en mode Docker).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_FILE=/data/albummania.db
COPY --from=build /app /app
# La base SQLite vit dans /data : monte un volume persistant à cet endroit.
VOLUME /data
EXPOSE 3000
HEALTHCHECK CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
