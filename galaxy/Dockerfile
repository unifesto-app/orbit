# Built from the repo root: docker build -f galaxy/Dockerfile .
FROM node:24-slim
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @orbit/galaxy...
RUN pnpm --filter @orbit/galaxy build
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
WORKDIR /repo/galaxy
CMD ["pnpm", "exec", "next", "start", "-p", "3000"]
