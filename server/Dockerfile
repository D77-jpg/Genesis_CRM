# Build context: ./server. Never send .env, uploads, tests or node_modules (see .dockerignore).
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS production
ENV NODE_ENV=production HOST=0.0.0.0 PORT=5000 UPLOAD_DIR=/data/uploads
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force \
    && mkdir -p /data/uploads /backups \
    && chown -R node:node /data /backups /app
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "require('node:http').get('http://127.0.0.1:5000/api/health',r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>{try{const j=JSON.parse(b);process.exit(r.statusCode===200&&j.data?.status==='ok'?0:1)}catch{process.exit(1)}})}).on('error',()=>process.exit(1))"
CMD ["node", "dist/index.js"]
