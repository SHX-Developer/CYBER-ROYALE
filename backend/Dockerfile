FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY nest-cli.json tsconfig.json tsconfig.seed.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache dumb-init openssl

COPY --from=build /app/package*.json ./
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/tsconfig.seed.json ./tsconfig.seed.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["dumb-init", "./docker-entrypoint.sh"]
CMD ["node", "dist/src/main.js"]
