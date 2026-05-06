# CYBER ROYALE

Mobile Telegram Web App card battle arena. Игрок ставит карты, юниты автоматически идут по линиям и атакуют башни.

**Стиль:** минималистичная fantasy arena
**Платформа:** только Telegram Web App, вертикальный экран, touch
**MVP:** против бота → потом онлайн 1 на 1

---

## Структура

```
project/
├── frontend/      # React + Vite + TypeScript + Phaser 3 + Zustand + TWA SDK
├── backend/       # NestJS + Prisma + PostgreSQL
└── docker-compose.yml
```

## Запуск локально

### Требования
- Node.js 20+
- PostgreSQL 14+ (локально или Docker)
- npm 10+

### Frontend

```bash
cd frontend
npm install
npm run dev
```

По умолчанию: http://localhost:5173

### Backend

```bash
cd backend
cp .env.example .env
# отредактируй DATABASE_URL под свою PostgreSQL
npm install
npx prisma migrate dev --name init    # создаст таблицы
npm run prisma:seed                    # засеет 8 MVP-карт
npm run start:dev
```

По умолчанию: http://localhost:3000

### Быстрый PostgreSQL через Docker

```bash
docker run --name cyber-royale-db \
  -e POSTGRES_USER=cyber \
  -e POSTGRES_PASSWORD=cyber \
  -e POSTGRES_DB=cyber_royale \
  -p 5432:5432 -d postgres:16
```

И в `backend/.env`:
```
DATABASE_URL="postgresql://cyber:cyber@localhost:5432/cyber_royale?schema=public"
```

## Docker/VPS

### Подготовка сервера

На VPS нужны Docker Engine и Docker Compose plugin.

```bash
cp .env.example .env
```

В `.env` обязательно поменяй:

```dotenv
POSTGRES_PASSWORD=strong_password
TELEGRAM_BOT_TOKEN=123456789:AA...
DEV_AUTO_LOGIN=0
WEB_PORT=80
VITE_API_URL=/api
```

### Запуск

```bash
docker compose up --build -d
```

При старте backend автоматически выполняет:

```bash
npx prisma migrate deploy
npx prisma db seed
```

Проверка:

```bash
docker compose ps
curl http://localhost/health
curl http://localhost/api/health
```

Frontend доступен на `http://SERVER_IP/`.
API проксируется через nginx по пути `/api/*` на backend.

### Dokploy с отдельной PostgreSQL Database

Если база создана отдельным сервисом в Dokploy, используй compose path:

```text
docker-compose.dokploy.yml
```

В переменную `DATABASE_URL` вставь Internal Connection URL из Dokploy и добавь
в конец `?schema=public`, если его там нет.

### Полезные команды

```bash
docker compose logs -f backend
docker compose logs -f frontend
docker compose restart backend
docker compose down
```

---

## Telegram-бот (Этап 2)

### 1. Создать бота

В Telegram открой [@BotFather](https://t.me/BotFather) и:

```
/newbot
<имя бота>      → CYBER ROYALE
<username>      → cyber_royale_bot   (должен заканчиваться на _bot и быть свободным)
```

BotFather пришлёт **токен вида `123456789:AA…`** — сохрани в `backend/.env`:

```
TELEGRAM_BOT_TOKEN="123456789:AA..."
```

### 2. Подключить Web App к боту

В диалоге с BotFather:

```
/setmenubutton
<выбери своего бота>
<URL твоего фронта>   → пока локально через туннель (см. ниже),
                         в проде — https://your-domain/
<подпись кнопки>      → ⚔️ Играть
```

### 3. Локальная разработка

Telegram открывает Web App только по HTTPS, поэтому для теста с реальным
Telegram нужен туннель:

```bash
# например через ngrok
ngrok http 5173
```

В `frontend/.env`:
```
VITE_API_URL=https://<твой-туннель-для-бэка>
```
а в BotFather меню-кнопке указать `https://<туннель-для-фронта>/`.

### 4. Без Telegram (быстрая локальная проверка)

В `backend/.env`:
```
DEV_AUTO_LOGIN="1"
```

Тогда `POST /auth/telegram` с пустой `initData` вернёт фиктивного юзера —
удобно открывать фронт прямо в браузере на `http://localhost:5173`.
**На проде ставить `DEV_AUTO_LOGIN=0`.**

### Как это работает

1. Telegram открывает фронт и в `window.Telegram.WebApp.initData` кладёт подписанные данные пользователя.
2. Фронт сразу шлёт `POST /auth/telegram { initData }`.
3. Бэкенд проверяет HMAC-SHA256 подпись по `TELEGRAM_BOT_TOKEN` (см. `backend/src/auth/telegram.ts`).
4. Если подпись валидна — апсертит юзера в БД и возвращает профиль.

---

## Этапы

- [x] Этап 0 — Концепция
- [x] Этап 1 — Создание проекта (техническая основа)
- [x] Этап 2 — Telegram Web App авторизация
- [x] Этап 3 — Главное меню
- [x] Этап 4 — Экран карт (8 MVP-карт)
- [x] Этап 5 — Docker, миграции и подготовка к VPS
- [x] Этап 6 — Прототип боевой сцены (Phaser-арена)
- [x] Этап 7 — Башни (модель + HP, damage, range, attackSpeed)
- [x] Этап 8 — Первый юнит (Warrior, кнопка Spawn)
- [x] Этап 9 — Движение по линии (waypoints через мост)
- [x] Этап 10 — Поиск цели (юнит → принцесса → король)
- [x] Этап 11 — Атака (HP-бары, кулдаун, урон)
- [x] Этап 12 — Разрушение башни и победа/поражение
- [x] Этап 13 — Авто-спавн врага каждые 5 секунд
- [x] Этап 14 — Бой юнит против юнита (idle/moving/attacking/dead)
- [x] Этап 15 — Смерть юнита (fade-out + удаление с поля)
- [x] Этап 16 — Карты внизу экрана (Warrior/Archer/Tank/Fireball)
- [x] Этап 17 — Энергия (10 max, регэн каждые 2.8с)
- [x] Этап 18 — Зоны размещения (своя половина, не на башни) + подсветка
- [x] Этап 19 — Колода 8 карт, очередь рука/next
- [x] Этап 20 — Заклинание Fireball (250 юнитам / 100 башням / r 90)
- [x] Этап 21 — Таймер боя (3 минуты)
- [x] Этап 22 — Условия победы (king-kill / по таймеру / DRAW)
- [x] Этап 23 — Простой AI-бот (своя энергия, колода, спеллы)
- [x] Этап 24 — Стартовый баланс (см. UNIT_STATS / TOWER_STATS / SPELL_STATS)
- [x] Этап 25 — Базовые эффекты (spawn, damage flash, death poof, screen shake)
- [x] Этап 26 — Экран результата (counts, duration, coins, xp, play again)
- [x] Этап 27 — Сохранение результата (POST /battles/report → User.coins/xp/wins)
- [x] Этап 28 — Профиль игрока (xp, wins, losses, winrate)
- [x] Этап 29 — BattleEngine отделён от Phaser (`frontend/src/battle/`)
- [x] **Этап 30 — MVP-релиз ✅**

---

## MVP — что есть

- ✅ Telegram Web App (вертикальный, padding 100px под кнопки)
- ✅ Главное меню (профиль + Играть + Колода/Карты/Профиль)
- ✅ Экран боя — арена 360×720, 6 башен, 8 карт, рука 4 + next
- ✅ Энергия (10 max, регэн 1 / 2.8s)
- ✅ Размещение юнитов (только своя половина, не на башни)
- ✅ Движение по линии через мост → атака ближайшей цели
- ✅ Бой юнит ↔ юнит, юнит ↔ башня
- ✅ Заклинание Fireball (250 / 100 / r 90)
- ✅ Простой бот с энергией и колодой
- ✅ Победа / Поражение / Ничья (king-kill или 3-минутный таймер)
- ✅ Экран результата (счёт, длительность, монеты, опыт)
- ✅ Сохранение результата → backend (Battle history + User stats)
- ✅ Профиль с прогрессом (xp / wins / losses / winrate)
- ✅ Docker compose + Dokploy + nginx + healthcheck
- ✅ Архитектура `BattleEngine` отделена от Phaser → готово к онлайн-PvP

## Не входит в MVP

- ❌ Онлайн PvP (есть архитектурный задел через BattleEngine)
- ❌ Магазин и донат
- ❌ Сундуки
- ❌ Кланы
- ❌ Глобальный рейтинг
- ❌ Скины и кастомизация
- ❌ Прокачка карт (apenas базовые статы)
- ❌ Большая коллекция персонажей (8 карт)

## Миграция БД

Миграции применяются автоматически при каждом деплое — `docker-entrypoint.sh`
вызывает `prisma db push --accept-data-loss` на старте backend-контейнера.
Локально ничего генерить не надо: меняешь `prisma/schema.prisma`, пушишь —
Dokploy пересобирает образ, контейнер стартует, БД синхронизируется со схемой.

Если потребуется строгий миграционный контроль с историей и rollback'ом,
переключи `docker-entrypoint.sh` на `prisma migrate deploy` и начни
генерить миграции локально через `npm run prisma:migrate`.
