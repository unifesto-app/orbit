# Built from the repo root: docker build -f api/Dockerfile .
FROM node:24-slim
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @orbit/api...
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
WORKDIR /repo/api
CMD ["node", "--experimental-strip-types", "src/server.ts"]
