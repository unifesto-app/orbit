# Built from the repo root: docker build -f console/Dockerfile .
FROM node:24-slim
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @orbit/console...
RUN pnpm --filter @orbit/console build
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
WORKDIR /repo/console
CMD ["pnpm", "exec", "next", "start", "-p", "3000"]
