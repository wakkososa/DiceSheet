# ---- build ----
FROM node:22-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY build.mjs ./
COPY shim ./shim
COPY src ./src
COPY vendor ./vendor
COPY web ./web
RUN npm run build

# ---- run ----
# The server is a single bundled file; no node_modules are needed at runtime.
FROM node:22-slim
ENV NODE_ENV=production \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    DATA_DIR=/data \
    PORT=3000
WORKDIR /app
COPY --from=build /src/dist/main.js ./main.js
COPY --from=build /src/dist/web ./web
COPY vendor/License.md ./LICENSE-DiceCloud.md
RUN mkdir -p /data && chown node:node /data
# Starts as root only to fix ownership of the mounted /data folder, then
# immediately switches to the unprivileged "node" user (uid 1000).
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/session').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "main.js"]
