# PolyStoreX Backend

NestJS + Prisma API for PolyStoreX (`/api/v1`).

## Setup

```bash
cp .env.example .env
npm install
npx prisma generate
npm run start:dev
```

Keep real secrets in `.env` or the host environment only. `.env.example` is the committed template.

## Production

```bash
npm run build
npm run prisma:migrate:deploy
npm run start:prod
```
