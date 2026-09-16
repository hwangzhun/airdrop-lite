FROM node:22-alpine AS web-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html index.tsx index.css App.tsx icon.svg types.ts vite-env.d.ts vite.config.ts tsconfig.json ./
COPY components ./components
COPY services ./services
COPY views ./views
RUN npm run build:web

FROM golang:1.26-alpine AS server-build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY server ./server
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/airdrop-lite ./server

FROM alpine:3.24 AS runtime
RUN apk add --no-cache coturn \
    && addgroup -S airdrop \
    && adduser -S -D -H -G airdrop airdrop
WORKDIR /app
ENV NODE_ENV=production PORT=8080 TURN_PORT=3478 TURN_MIN_PORT=49160 TURN_MAX_PORT=49200
COPY --from=web-build --chown=airdrop:airdrop /app/dist ./dist
COPY --from=server-build --chown=airdrop:airdrop /out/airdrop-lite ./airdrop-lite
USER airdrop
EXPOSE 8080/tcp 3478/tcp 3478/udp 49160-49200/udp
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/app/airdrop-lite", "healthcheck"]
ENTRYPOINT ["/app/airdrop-lite", "serve", "--with-turn"]
