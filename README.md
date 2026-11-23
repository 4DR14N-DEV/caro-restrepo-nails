<p align="center">
  <img src="docs/assets/banner.png" alt="Caro Restrepo Nails: reservas en línea para el spa de uñas de Caro Restrepo" width="100%">
</p>

<p align="center">
  <a href="https://github.com/4DR14N-DEV/caro-restrepo-nails/actions/workflows/ci.yml"><img src="https://github.com/4DR14N-DEV/caro-restrepo-nails/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/accesibilidad-100-2f6b45?style=flat-square" alt="Accesibilidad 100 en Lighthouse">
  <img src="https://img.shields.io/badge/costo%20de%20infraestructura-%240-9a4a62?style=flat-square" alt="Costo de infraestructura $0">
  <img src="https://img.shields.io/badge/mobile-first-c9ae7e?style=flat-square" alt="Mobile first">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Astro-7-BC52EE?style=flat-square&logo=astro&logoColor=white" alt="Astro 7">
  <img src="https://img.shields.io/badge/React-19-149ECA?style=flat-square&logo=react&logoColor=white" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-6.0-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 6.0">
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind CSS 4">
  <img src="https://img.shields.io/badge/GSAP-3-0AE448?style=flat-square&logo=greensock&logoColor=black" alt="GSAP 3">
  <br>
  <img src="https://img.shields.io/badge/Node.js-24-5FA04E?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 24">
  <img src="https://img.shields.io/badge/Express-5-000000?style=flat-square&logo=express&logoColor=white" alt="Express 5">
  <img src="https://img.shields.io/badge/Drizzle_ORM-0.45-C5F74F?style=flat-square&logo=drizzle&logoColor=black" alt="Drizzle ORM 0.45">
  <img src="https://img.shields.io/badge/Zod-4-3E67B1?style=flat-square&logo=zod&logoColor=white" alt="Zod 4">
  <img src="https://img.shields.io/badge/PostgreSQL-Supabase-3FCF8E?style=flat-square&logo=supabase&logoColor=white" alt="PostgreSQL en Supabase">
  <img src="https://img.shields.io/badge/Netlify-Functions-00C7B7?style=flat-square&logo=netlify&logoColor=white" alt="Netlify Functions">
  <br>
  <img src="https://img.shields.io/badge/Vitest-5-6E9F18?style=flat-square&logo=vitest&logoColor=white" alt="Vitest 5">
  <img src="https://img.shields.io/badge/ESLint-10-4B32C3?style=flat-square&logo=eslint&logoColor=white" alt="ESLint 10">
  <img src="https://img.shields.io/badge/Prettier-3-F7B93E?style=flat-square&logo=prettier&logoColor=black" alt="Prettier 3">
  <img src="https://img.shields.io/badge/pnpm-12-F69220?style=flat-square&logo=pnpm&logoColor=white" alt="pnpm 12">
</p>

# Caro Restrepo Nails

Aplicación web de reservas para el spa de uñas de Caro Restrepo. Reemplaza la agenda en papel:
las clientas ven el catálogo, reservan, cancelan y reprograman desde el celular, y Caro maneja
su agenda, su horario, sus servicios y sus clientas desde un panel propio. Cada reserva le llega
a Caro como aviso en el celular.

| Documento                             | Para qué sirve                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| [Requisitos](docs/requirements.md)    | Roles, requisitos funcionales y reglas de negocio                                   |
| [Modelo de datos](docs/data-model.md) | Tablas y garantías en la base de datos                                              |
| [Decisiones](docs/decisions.md)       | Qué se eligió en la arquitectura y el diseño, y por qué                             |
| [Entregas](odd/tasks)                 | Bitácora de cada entrega: specs, tareas y pruebas                                   |
| [Guía para Caro](docs/guia-caro.pdf)  | Paso a paso del panel, sin términos técnicos (PDF; fuente en `docs/guia-caro.html`) |

## Qué hace

**Para las clientas**

- Catálogo público de servicios con precio y duración; al elegir varios, muestra el total.
- Reserva en pocos pasos: servicios → día → hora → confirmar, con confirmación inmediata si la
  hora está libre y un botón para avisarle a Caro por WhatsApp.
- "Mis citas": próximas e historial, cancelar (hasta 2 horas antes) y reprogramar (con 2 días o
  más de anticipación).
- Cuenta con celular y contraseña: cambiar la contraseña o borrar la cuenta (los datos se
  anonimizan, Ley 1581 de 2012).

**Para Caro**

- Agenda por día, semana y mes; marcar cada cita como completada, no asistió o cancelada.
- Crear, editar y mover citas a nombre de una clienta, sin las restricciones de las clientas.
- Bloquear días o franjas, programar descansos y abrir más temprano.
- Horario base, margen entre citas y reglas de reserva, cancelación y reprogramación.
- Servicios (crear, editar, activar y desactivar) y clientas (buscar y generar una contraseña
  nueva para enviársela por WhatsApp).
- Avisos push en el celular cuando una clienta reserva, cancela o reprograma, y recordatorios
  por WhatsApp con el mensaje ya escrito.

**El sistema**

- Domingos y festivos de Colombia bloqueados automáticamente.
- La base de datos impide que dos citas se superpongan, incluido el margen entre ellas.
- Tema claro ("Nude editorial") y oscuro ("Noche de salón"), que sigue al celular y se puede
  elegir; letrero animado con GSAP en la portada.

## Tecnologías

| Capa       | Tecnología                                                                | Por qué                                                               |
| ---------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Sitio      | Astro 7 + React 19 en islas, Tailwind CSS 4                               | Páginas estáticas que cargan rápido; React solo donde hay interacción |
| Animación  | GSAP 3 (con DrawSVG)                                                      | El letrero se "escribe" a mano; se descarga solo cuando se anima      |
| API        | Express 5 sobre Netlify Functions (`serverless-http`)                     | Una app de Express independiente de la plataforma (`createApp()`)     |
| Datos      | PostgreSQL en Supabase, Drizzle ORM, migraciones versionadas              | Restricciones en la base (superposición, unicidad) y SQL tipado       |
| Validación | Zod 4, compartido entre la API y la web (`@caro/shared`)                  | Las mismas reglas y mensajes en el formulario y en el servidor        |
| Seguridad  | Argon2id, sesiones en Postgres con cookie `httpOnly`, límites de intentos | Contraseñas y sesiones según OWASP                                    |
| Avisos     | Web Push (VAPID) con `web-push`, enlaces `wa.me`                          | Notificaciones gratis, sin la API paga de WhatsApp                    |
| Calidad    | Vitest, ESLint, Prettier, TypeScript estricto, GitHub Actions             | Cada PR pasa formato, lint, tipos, tests y build                      |

## Arquitectura

```
caro-restrepo-nails/
├── apps/
│   ├── web/          Astro + React + Tailwind → sitio estático en Netlify
│   └── api/          Express + Drizzle → una función de Netlify (/api/*)
│       └── netlify/functions/
│           ├── api.ts         toda la API
│           └── keepalive.ts   consulta programada para que Supabase no se pause
├── packages/
│   └── shared/       esquemas de Zod, textos y reglas que usan la API y la web
└── docs/             requisitos, modelo de datos y decisiones
```

En producción, Netlify sirve el sitio y redirige `/api/*` a la función de Express, que se
conecta a Postgres en Supabase por el pooler. Todo corre en los planes gratis (RNF05).

## Desarrollo local

**Necesitás:** Node 24 (`.nvmrc`), pnpm (el único gestor de paquetes del proyecto) y Docker para
el Postgres local.

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

Después, la API y la web en dos terminales. La web reenvía `/api` a la API local, igual que
Netlify en producción:

```sh
DATABASE_URL=postgres://caro:caro@localhost:5433/caro pnpm --filter @caro/api dev
pnpm --filter @caro/web dev   # http://127.0.0.1:4321
```

### Comandos

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

## Páginas

| Página               | Quién      | Qué hace                                                                                                                     |
| -------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `/`                  | Pública    | Portada con el letrero animado, reservar e ingresar; para Caro, los enlaces del panel y "Activar avisos en este dispositivo" |
| `/servicios`         | Pública    | Catálogo con precio y duración; al elegir varios muestra el total                                                            |
| `/reservar`          | Con sesión | Servicios → día → hora → confirmar; después, botón para avisar a Caro por WhatsApp                                           |
| `/mis-citas`         | Con sesión | Citas próximas e historial; cancelar, reprogramar, cambiar la contraseña o borrar la cuenta                                  |
| `/registro`          | Pública    | Crear cuenta con celular y contraseña; vuelve a `next` si es una ruta interna                                                |
| `/ingreso`           | Pública    | Ingresar; vuelve a `next` si es una ruta interna                                                                             |
| `/politica-de-datos` | Pública    | Política de tratamiento de datos (Ley 1581 de 2012)                                                                          |
| `/admin/agenda`      | Solo Caro  | Agenda por día, semana y mes, estados, bloqueos, descansos y recordatorios; `?dia=AAAA-MM-DD` abre ese día                   |
| `/admin/servicios`   | Solo Caro  | Crear, editar, activar y desactivar servicios                                                                                |
| `/admin/horario`     | Solo Caro  | Horario de lunes a sábado, margen y reglas; avisa las citas que quedan fuera del nuevo horario                               |
| `/admin/clientas`    | Solo Caro  | Clientas con filtro; generar una contraseña nueva y enviarla por WhatsApp                                                    |

Sin sesión, las páginas privadas llevan a `/ingreso?next=…`; la API responde 401 sin sesión y 403
si la cuenta no es de Caro.

## Producción

### Variables de entorno en Netlify

| Variable            | Valor                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `DATABASE_URL`      | Pooler de Supabase en **modo transacción** (puerto `6543`): cada función abre su conexión |
| `VAPID_PUBLIC_KEY`  | De `pnpm --filter @caro/api push:keys`                                                    |
| `VAPID_PRIVATE_KEY` | De `pnpm --filter @caro/api push:keys` (marcala como secreta)                             |
| `VAPID_SUBJECT`     | `mailto:` seguido de un correo de contacto, sin espacios                                  |

Sin las tres VAPID no se envían avisos. Si se cambian las claves, Caro vuelve a activar los
avisos en cada dispositivo. Las migraciones y los comandos (`db:migrate`, `db:seed`,
`db:create-admin`) se corren desde tu máquina con el pooler en **modo sesión** (puerto `5432`).

### Supabase no se pausa

El plan gratis de Supabase pausa los proyectos con poca actividad durante una semana. La función
programada `keepalive` consulta la base **cada 6 horas** (horario UTC) y solo corre en el deploy
publicado. Para comprobarla: Netlify → Logs → Functions → `keepalive` debe mostrar
`Base activa: N servicios.` Si Supabase igual manda el correo de aviso, entrá al panel de
Supabase y el proyecto se reactiva.

### Respaldo y restauración

El plan gratis no ofrece respaldos descargables, así que se hacen a mano: **antes del
lanzamiento y una vez al mes**. Usá la conexión en modo sesión (puerto `5432`) y una imagen de
Postgres con la misma versión mayor que muestra Supabase (Project Settings → Infrastructure):

```sh
# Respaldo (queda en la carpeta actual)
docker run --rm -v "$PWD:/backup" postgres:17 \
  pg_dump "postgresql://…:5432/postgres" --schema=public --schema=drizzle \
  --no-owner --no-privileges -Fc -f "/backup/caro-$(date +%F).dump"

# Restauración (reemplaza las tablas de la base de destino)
docker run --rm -v "$PWD:/backup" postgres:17 \
  pg_restore -d "postgresql://…:5432/postgres" --clean --if-exists --no-owner \
  "/backup/caro-AAAA-MM-DD.dump"
```

> [!IMPORTANT]
> El respaldo tiene nombres y celulares de clientas (Ley 1581): guardalo fuera del repositorio,
> en un lugar privado, y borrá los viejos que ya no necesites.

### Dominio propio (opcional)

1. Comprar el dominio (por ejemplo, en un registrador `.co`).
2. Netlify → Domain management → **Add a domain** y seguir los pasos para apuntar el DNS.
3. Netlify emite el certificado HTTPS solo. Los avisos push siguen funcionando, pero Caro tiene
   que activarlos de nuevo en la dirección nueva.

## Lista de lanzamiento

- [ ] Variables de entorno cargadas en Netlify (`DATABASE_URL` y las tres VAPID).
- [ ] Servicios, precios, duraciones, horario y reglas revisados y confirmados por Caro.
- [ ] Datos de prueba borrados de Supabase (cuentas y citas de prueba).
- [ ] Cuenta de Caro con su contraseña propia (`db:create-admin` también la cambia).
- [ ] Página instalada en la pantalla de inicio del celular de Caro y avisos activados.
- [ ] Política de datos revisada y aprobada por Caro (hoy es un borrador).
- [ ] Primer respaldo hecho y guardado en un lugar privado.
- [ ] Al otro día del lanzamiento: `keepalive` corrió en Netlify.

## Calidad

- **CI** en cada PR y en cada push a `main`: formato, lint, tipos, tests (unitarios, de HTTP y de
  integración contra Postgres) y build.
- **Accesibilidad:** Lighthouse 100 en las 11 páginas, en tema claro y oscuro (entrega 14):
  contraste, etiquetas, botones de al menos 44 px y errores que se anuncian a los lectores de
  pantalla.
- **Rendimiento:** páginas estáticas, fuentes alojadas en el sitio, JavaScript solo en las islas
  y datos de la API pedidos apenas llega el HTML.

## Convenciones

- Código e identificadores en inglés; comentarios, documentación e interfaz en español.
- Conventional Commits (`feat:`, `fix:`, `docs:`…), una rama por funcionalidad y PR hacia `main`.
- Dinero en pesos colombianos como enteros; fechas `timestamptz`, mostradas en America/Bogota.
- Test primero en el motor de disponibilidad y en las reglas de negocio.

## Licencia

Software propietario. © 2026 Adrian Restrepo ([4DR14N-DEV](https://github.com/4DR14N-DEV)).
Todos los derechos reservados: no se permite usarlo, copiarlo, modificarlo ni distribuirlo sin
autorización por escrito. Ver [LICENSE](LICENSE).
