# KNOPIK TAP

Мобильная PWA-игра с облачными аккаунтами и синхронизацией прогресса через Supabase.

## Локальный запуск

Требуется Node.js 22.13 или новее.

```bash
npm install
copy .env.example .env.local
npm run dev
```

В `.env.local` нужно указать активный publishable key проекта Supabase. Secret key и `service_role` никогда не должны попадать во фронтенд или GitHub.

## Supabase

Целевой project ref: `uxxzvjwsexdoqcevzipu`.

Миграция в `supabase/migrations/` создаёт:

- профили игроков;
- облачные сохранения с оптимистичными ревизиями;
- журнал админских начислений;
- RLS-политики для изоляции прогресса;
- атомарные функции сохранения и начисления монет;
- Realtime-публикацию сохранений.

Одноразовая Edge Function `bootstrap-knopik-users` предназначена только для безопасного создания первых пользователей через Admin API. Перед развёртыванием placeholder заменяется SHA-256-хешем случайного одноразового токена. После успешного создания пользователей функцию нужно сразу развернуть повторно в отключённом виде.

## GitHub Pages

Workflow `.github/workflows/deploy-pages.yml` собирает статическую версию и публикует каталог `out`.

В настройках репозитория необходимо:

1. Выбрать GitHub Actions как источник Pages.
2. Создать Repository variable `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` с publishable key проекта.
3. Разрешить origin GitHub Pages в настройках URL/redirects Supabase Auth.

Workflow автоматически подставляет путь репозитория, поэтому PWA, изображения и Service Worker работают по адресу вида `https://circon3m22.github.io/knopik-tap/`.

## Проверка

```bash
npm test
```

Отдельная статическая сборка для Pages:

```bash
npm run build:pages
```
