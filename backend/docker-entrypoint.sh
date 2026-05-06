#!/bin/sh
set -e

# Этап 27/30: миграции применяются автоматически при старте контейнера.
#
# Используем `prisma db push` вместо `migrate deploy` — синхронизирует
# схему напрямую с БД, не требуя файлов миграций. Для MVP этого достаточно:
#   • безопасно для нашего случая (только добавление колонок),
#   • не нужно поднимать локальную PG только чтобы сгенерить SQL,
#   • идемпотентно: при следующем запуске ничего не делает, если схема та же.
#
# Когда потребуется строгий миграционный контроль (rollback, история),
# переключиться на `prisma migrate deploy` + регулярная генерация миграций.
if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
  echo "[entrypoint] syncing prisma schema with database…"
  npx prisma db push --skip-generate --accept-data-loss
fi

if [ "${RUN_SEED:-1}" = "1" ]; then
  echo "[entrypoint] seeding cards…"
  npx prisma db seed
fi

exec "$@"
