FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml* ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/protocol/package.json packages/protocol/package.json
RUN pnpm install --frozen-lockfile=false
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/apps/server/package.json /app/apps/server/package.json
COPY --from=build /app/packages/protocol/package.json /app/packages/protocol/package.json
COPY --from=build /app/apps/server/dist /app/apps/server/dist
COPY --from=build /app/apps/web/dist /app/apps/server/public
COPY --from=build /app/packages/protocol/dist /app/packages/protocol/dist
COPY --from=build /app/node_modules /app/node_modules
EXPOSE 3000
CMD ["node", "apps/server/dist/index.js"]
