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
packages/
  shared/ → Esquemas de Zod compartidos por la API y la web.
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

# Cuenta admin de Caro (pide nombre, celular y contraseña; la contraseña no se muestra)
DATABASE_URL=postgres://caro:caro@localhost:5433/caro pnpm db:create-admin
```

Para desarrollar, corre la API y la web en dos terminales. La web reenvía `/api` a la API local,
igual que Netlify en producción:

```sh
DATABASE_URL=postgres://caro:caro@localhost:5433/caro pnpm --filter @caro/api dev
pnpm --filter @caro/web dev   # http://127.0.0.1:4321
```

## Páginas

| Página             | Quién      | Qué hace                                                                                                                                                                                                                                                   |
| ------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                | Pública    | Inicio con reservar, ingresar y, para Caro, los enlaces del panel y "Activar avisos en este dispositivo" (avisos push cuando una clienta reserva, cancela o reprograma; en iPhone, solo con la página agregada a la pantalla de inicio)                    |
| `/servicios`       | Pública    | Catálogo con precio y duración; al elegir varios muestra el total                                                                                                                                                                                          |
| `/reservar`        | Con sesión | Servicios → día → hora → confirmar; después, botón para avisar a Caro por WhatsApp. Sin sesión lleva a `/ingreso?next=/reservar`                                                                                                                           |
| `/mis-citas`       | Con sesión | Citas próximas e historial (últimas 20) con estado, servicios y total. Sin sesión lleva a `/ingreso?next=/mis-citas`; en "Mi cuenta", cambiar la contraseña o borrar la cuenta                                                                             |
| `/registro`        | Pública    | Crear cuenta con celular y contraseña; vuelve a `next` si es una ruta interna                                                                                                                                                                              |
| `/ingreso`         | Pública    | Ingresar; vuelve a `next` si es una ruta interna                                                                                                                                                                                                           |
| `/admin/agenda`    | Solo Caro  | Agenda por día, semana y mes; marcar completada, no asistió o cancelar; recordar y avisar por WhatsApp; bloquear días o franjas, descansos y abrir más temprano; `?dia=AAAA-MM-DD` abre ese día (así la abren los avisos push) (la API responde 401 o 403) |
| `/admin/servicios` | Solo Caro  | Crear, editar, activar y desactivar servicios (la API responde 401 o 403)                                                                                                                                                                                  |
| `/admin/horario`   | Solo Caro  | Horario de lunes a sábado, margen entre citas y reglas de reserva, cancelación y reprogramación; avisa las citas que quedan fuera del nuevo horario (la API responde 401 o 403)                                                                            |
| `/admin/clientas`  | Solo Caro  | Clientas con cuenta, con filtro por nombre o celular; generar una contraseña nueva y enviarla por WhatsApp (la API responde 401 o 403)                                                                                                                     |

## Comandos

| Comando                                   | Qué hace                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------- |
| `pnpm --filter @caro/api dev`             | API local en `http://localhost:3000` (requiere `DATABASE_URL`)                   |
| `pnpm --filter @caro/web dev`             | Sitio local con Astro; reenvía `/api` a la API local                             |
| `pnpm lint` / `pnpm format:check`         | ESLint y Prettier                                                                |
| `pnpm typecheck`                          | Chequeo de tipos de todo el monorepo                                             |
| `pnpm test`                               | Tests unitarios y de HTTP                                                        |
| `pnpm test:db`                            | Tests de integración contra Postgres (requiere `TEST_DATABASE_URL`)              |
| `pnpm --filter @caro/api db:generate`     | Genera una migración a partir de `src/db/schema.ts`                              |
| `pnpm --filter @caro/api db:create-admin` | Crea la cuenta admin de Caro o le cambia la contraseña (requiere `DATABASE_URL`) |
| `pnpm --filter @caro/api push:keys`       | Genera las claves VAPID de los avisos push                                       |

## Producción (Netlify + Supabase)

- Variable de entorno en Netlify: `DATABASE_URL` con el pooler de Supabase en **modo transacción**
  (puerto `6543`), porque cada función abre su propia conexión.
- Avisos push: `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY` (de `pnpm --filter @caro/api push:keys`) y
  `VAPID_SUBJECT` (`mailto:` con un correo de contacto). Sin las tres no se envían avisos. Si se
  cambian las claves, Caro vuelve a activar los avisos en cada dispositivo.
- Las migraciones y los comandos (`db:migrate`, `db:seed`, `db:create-admin`) se corren desde tu
  máquina con el pooler en modo sesión (puerto `5432`).

## Convenciones

- Código e identificadores en inglés; comentarios, documentación e interfaz en español.
- Conventional Commits (`feat:`, `fix:`, `docs:`…), una rama por funcionalidad y PR hacia `main`.
- Dinero en pesos colombianos como enteros; fechas `timestamptz`, mostradas en America/Bogota.
- Test primero en el motor de disponibilidad y en las reglas de negocio.
