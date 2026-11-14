# Built from the repo root: docker build -f web/Dockerfile .
FROM node:24-slim
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @orbit/web...
RUN pnpm --filter @orbit/web build
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
WORKDIR /repo/web
CMD ["pnpm", "exec", "next", "start", "-p", "3000"]
