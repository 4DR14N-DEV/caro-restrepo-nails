# Caro Restrepo Nails

Aplicación web de reservas para el spa de uñas de Caro Restrepo. Mobile first.

- Requisitos, roles y reglas de negocio: [docs/requirements.md](docs/requirements.md)
- Modelo de datos: [docs/data-model.md](docs/data-model.md)
- Decisiones de arquitectura: [docs/decisions.md](docs/decisions.md)

## Estructura

```
apps/
  api/   → Express + Drizzle (Postgres). Corre en Netlify Functions.
  web/   → Astro + React en islas + Tailwind. Sitio estático.
```

## Requisitos

- Node 24 (`.nvmrc`)
- pnpm (el único gestor de paquetes del proyecto)
- Docker, para el Postgres local

## Primeros pasos

```sh
pnpm install
cp .env.example .env
docker compose up -d --wait

# Base de datos local
cd apps/api
DATABASE_URL=postgres://caro:caro@localhost:5433/caro pnpm db:migrate
DATABASE_URL=postgres://caro:caro@localhost:5433/caro pnpm db:seed
```

## Comandos

| Comando                               | Qué hace                                                            |
| ------------------------------------- | ------------------------------------------------------------------- |
| `pnpm --filter @caro/api dev`         | API local en `http://localhost:3000`                                |
| `pnpm --filter @caro/web dev`         | Sitio local con Astro                                               |
| `pnpm lint` / `pnpm format:check`     | ESLint y Prettier                                                   |
| `pnpm typecheck`                      | Chequeo de tipos de todo el monorepo                                |
| `pnpm test`                           | Tests unitarios y de HTTP                                           |
| `pnpm test:db`                        | Tests de integración contra Postgres (requiere `TEST_DATABASE_URL`) |
| `pnpm --filter @caro/api db:generate` | Genera una migración a partir de `src/db/schema.ts`                 |

## Convenciones

- Código e identificadores en inglés; comentarios, documentación e interfaz en español.
- Conventional Commits (`feat:`, `fix:`, `docs:`…), una rama por funcionalidad y PR hacia `main`.
- Dinero en pesos colombianos como enteros; fechas `timestamptz`, mostradas en America/Bogota.
- Test primero en el motor de disponibilidad y en las reglas de negocio.
