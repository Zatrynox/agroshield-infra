# Infraestructura — AgroShield

[![CI](https://github.com/Zatrynox/agroshield-infra/actions/workflows/ci.yml/badge.svg)](https://github.com/Zatrynox/agroshield-infra/actions/workflows/ci.yml)

Dockerfiles, Compose y Caddy para ejecutar AgroShield con **un solo origen**: la landing en `/`, el panel en `/app`, la API en `/api` y la documentación en `/docs` (solo local).

> **Repositorio de infraestructura.** Se extrae del monorepo [`Zatrynox/agroshield`](https://github.com/Zatrynox/agroshield), que sigue siendo la fuente de verdad y el contexto de build de las imágenes. Este repositorio conserva la carpeta `infra/`, los Compose y el validador para revisar y reutilizar la topología; no incluye el código de la API, el panel ni la landing. Para construir y levantar el stack completo, usa el monorepo.

## Contenido

```text
.
├── compose.yaml            Stack local autocontenido (HTTP, 8080)
├── compose.dev.yaml        Hot reload con bind mount
├── compose.prod.yaml       Producción con TLS/ACME
├── infra/
│   ├── docker/             Dockerfiles, Caddyfiles y entrypoint de Caddy
│   └── env/                Plantilla de entorno de producción
├── scripts/
│   └── validate-infra.mjs  Validación estática de Compose, imágenes y Caddy
└── .github/workflows/ci.yml
```

## Verificación

```bash
pnpm install --frozen-lockfile
pnpm verify:infra
```

La CI también renderiza los tres Compose con variables ficticias y valida ambos Caddyfiles con la imagen fijada de Caddy `2.11.7`.

## Documentación detallada

- [`infra/README.md`](infra/README.md) — imágenes, routing, endurecimiento, puesta en marcha y resultados de verificación.
- [`infra/env/prod.env.example`](infra/env/prod.env.example) — variables requeridas en producción, sin secretos.
- [`SECURITY.md` del monorepo](https://github.com/Zatrynox/agroshield/blob/main/SECURITY.md) — modelo de seguridad y hardening.

## Repositorios relacionados

- [`agroshield`](https://github.com/Zatrynox/agroshield) — monorepo y fuente de verdad.
- [`agroshield-backend`](https://github.com/Zatrynox/agroshield-backend) — API Fastify.
- [`agroshield-frontend`](https://github.com/Zatrynox/agroshield-frontend) — panel Vue.
- [`agroshield-landing`](https://github.com/Zatrynox/agroshield-landing) — sitio Astro.
- [`agroshield-design-tokens`](https://github.com/Zatrynox/agroshield-design-tokens) — tokens compartidos.
- [`agroshield-docs`](https://github.com/Zatrynox/agroshield-docs) — documentación y QA.

## Licencia

Sin licencia concedida todavía. La configuración se publica para revisión; no se autoriza su reutilización fuera de AgroShield hasta que se defina una licencia.
