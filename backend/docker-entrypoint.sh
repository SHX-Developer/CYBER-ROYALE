#!/bin/sh
set -e

if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
  npx prisma migrate deploy
fi

if [ "${RUN_SEED:-1}" = "1" ]; then
  npx prisma db seed
fi

exec "$@"
