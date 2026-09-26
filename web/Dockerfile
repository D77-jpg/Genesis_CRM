# Build context: ./web. Vite variables are baked into static JS, never pass secrets.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
ARG VITE_API_BASE_URL=/api
ARG VITE_APP_TITLE=Genesis CRM
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL} VITE_APP_TITLE=${VITE_APP_TITLE}
RUN npm run build

FROM nginx:1.27-alpine AS production
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
RUN mkdir -p /var/cache/nginx /var/run /tmp/nginx \
    && chown -R nginx:nginx /var/cache/nginx /var/run /tmp/nginx /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/api/health || exit 1
CMD ["nginx", "-g", "daemon off;"]
