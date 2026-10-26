FROM node:22-bookworm-slim AS build
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 DATA_DIR=/app/data NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/next.config.ts ./next.config.ts
RUN npm ci --omit=dev && mkdir -p /app/data && chown node:node /app/data
COPY --from=build --chown=node:node /app/.next-production ./.next-production
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/scripts/serve.mjs ./scripts/serve.mjs
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=15s --start-period=30s CMD node -e "fetch('http://127.0.0.1:3000/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/serve.mjs"]
