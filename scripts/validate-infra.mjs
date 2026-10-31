#!/usr/bin/env node
/**
 * Static checks for the Docker topology. This does not replace `docker compose
 * config` or a real `up`; it catches unsafe edits before Docker is available.
 *
 * Caddy syntax is validated when a `caddy` binary is on PATH (or CADDY_BIN is
 * set). CI additionally validates it inside the pinned Caddy image.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`ok - ${name}`);
    return;
  }
  failures.push(`${name}${detail ? `: ${detail}` : ''}`);
  console.log(`FAIL - ${name}${detail ? `: ${detail}` : ''}`);
}

function read(relative) {
  return readFileSync(resolve(root, relative), 'utf8');
}

const composeFiles = ['compose.yaml', 'compose.dev.yaml', 'compose.prod.yaml'];
const parsed = {};
for (const file of composeFiles) {
  try {
    parsed[file] = parse(read(file), { merge: true });
    check(`${file} parses`, Boolean(parsed[file]?.services));
  } catch (error) {
    check(`${file} parses`, false, error.message);
  }
}

const local = parsed['compose.yaml'];
const dev = parsed['compose.dev.yaml'];
const prod = parsed['compose.prod.yaml'];

check(
  'local stack publishes only the web port',
  Object.entries(local.services)
    .filter(([name]) => name !== 'web')
    .every(([, service]) => !service.ports?.length),
);
check('local web listens on 8080', local.services.web.ports?.includes('8080:8080'));
check('local db is on an internal data network', local.networks?.data?.internal === true);
check('local db is not exposed to the edge network', !local.services.db.networks?.includes('edge'));
check('local seed is part of the startup path', Boolean(local.services.seed));
check(
  'local backend waits for the seed',
  local.services.backend.depends_on?.seed?.condition === 'service_completed_successfully',
);
check(
  'local backend is read-only and drops capabilities',
  local.services.backend.read_only === true && local.services.backend.cap_drop?.includes('ALL'),
);
check('local seed refuses production use', local.services.seed.environment.NODE_ENV !== 'production');
check('local demo mode is explicit', local.services.seed.environment.DEMO_MODE === 'true');

check('dev stack parses all three app services', ['backend', 'frontend', 'landing'].every((name) => dev.services[name]));
check('dev db only binds loopback', dev.services.db.ports?.every((port) => String(port).startsWith('127.0.0.1:')));
check('dev db is on an internal network', dev.networks?.db?.internal === true);

check('prod has no demo seed', !prod.services.seed);
check('prod has no simulator', !prod.services.simulator);
check('prod backend does not run in demo mode', prod.services.backend.environment.DEMO_MODE === 'false');
check('prod backend uses secure cookies', prod.services.backend.environment.COOKIE_SECURE === 'true');
check('prod backend disables API docs', prod.services.backend.environment.ENABLE_API_DOCS === 'false');
check('prod db and backend publish no ports', !prod.services.db.ports && !prod.services.backend.ports);
check('prod db is on an internal data network', prod.networks?.data?.internal === true);
check('prod web publishes 80 and 443', ['80:8080', '443:8443'].every((port) => prod.services.web.ports?.includes(port)));
check('prod migrate runs before the backend', prod.services.backend.depends_on?.migrate?.condition === 'service_completed_successfully');
check('prod requires a non-empty domain', read('compose.prod.yaml').includes('PROD_SITE_DOMAIN:?'));
check('prod requires a non-empty session secret', read('compose.prod.yaml').includes('PROD_SESSION_SECRET:?'));
check('prod requires legal identity before building', read('compose.prod.yaml').includes('PROD_LEGAL_ENTITY:?'));
check(
  'prod contains no local demo credentials',
  !JSON.stringify(prod).includes('local-only') && !JSON.stringify(prod).includes('Demo-AgroShield'),
);

for (const [file, document] of Object.entries(parsed)) {
  for (const [name, service] of Object.entries(document.services ?? {})) {
    check(`${file}:${name} has an image or build`, Boolean(service.image || service.build));
    if (service.image) {
      const reference = String(service.image);
      const locallyBuilt = Boolean(service.build) && /^agroshield-[a-z-]+:(local|dev|prod)$/.test(reference);
      check(
        `${file}:${name} image is version-pinned or locally built`,
        locallyBuilt || reference.includes('@sha256:') || /:\d+\.\d+(\.\d+)?/.test(reference),
        reference,
      );
    }
  }
}

for (const [name, service] of Object.entries(local.services)) {
  if (['db', 'backend', 'web'].includes(name)) {
    check(`local ${name} has a healthcheck`, Boolean(service.healthcheck));
  }
}
for (const [name, service] of Object.entries(prod.services)) {
  if (['db', 'backend', 'web', 'migrate'].includes(name)) {
    check(`prod ${name} has a healthcheck or completes`, Boolean(service.healthcheck) || name === 'migrate');
  }
}

for (const file of ['infra/docker/backend.Dockerfile', 'infra/docker/web.Dockerfile', 'infra/docker/dev.Dockerfile']) {
  const content = read(file);
  check(`${file} uses a non-root USER`, /^USER\s+\S+/m.test(content));
  check(`${file} pins the Node image`, content.includes('node:24.15.0-alpine3.22'));
}

check('web Dockerfile pins Caddy', read('infra/docker/web.Dockerfile').includes('caddy:2.11.7-alpine'));
check('dockerignore excludes real env files', read('.dockerignore').includes('**/.env'));
check('web image serves the landing 404', read('infra/docker/Caddyfile').includes('/404.html'));
check('web image routes /app and /api', /handle \/app/.test(read('infra/docker/Caddyfile')) && /handle \/api/.test(read('infra/docker/Caddyfile')));
check('web image redirects bare /app to /app/', read('infra/docker/Caddyfile').includes('redir /app /app/ 308'));
check(
  'error responses import the security headers',
  /handle_errors\s*\{[\s\S]*?import agroshield_security/.test(read('infra/docker/Caddyfile')),
);
check('prod Caddyfile enables HSTS', read('infra/docker/Caddyfile.prod').includes('Strict-Transport-Security'));
check('prod Caddyfile has a health endpoint', read('infra/docker/Caddyfile.prod').includes('/healthz'));
check(
  'compose files build from the infrastructure Dockerfiles',
  ['compose.yaml', 'compose.dev.yaml', 'compose.prod.yaml'].every((file) =>
    read(file).includes('infra/docker/'),
  ),
);

const caddy = process.env.CADDY_BIN || 'caddy';
const caddyAvailable = spawnSync(caddy, ['version'], { stdio: 'ignore', shell: false }).status === 0;
if (!caddyAvailable) {
  console.log('skip - caddy binary not found; CI validates the Caddyfiles in the pinned image');
} else {
  const validations = [
    ['infra/docker/Caddyfile', {}],
    [
      'infra/docker/Caddyfile.prod',
      {
        SITE_ADDRESS: 'https://agroshield.example',
        ACME_EMAIL: 'ops@agroshield.example',
        API_UPSTREAM: 'backend:3000',
      },
    ],
  ];
  for (const [file, env] of validations) {
    const result = spawnSync(
      caddy,
      ['validate', '--config', resolve(root, file), '--adapter', 'caddyfile'],
      {
        stdio: 'pipe',
        shell: false,
        env: { ...process.env, ...env },
        encoding: 'utf8',
      },
    );
    check(
      `${file} validates`,
      result.status === 0,
      (result.stderr || result.stdout || '').trim().slice(0, 500),
    );
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} infrastructure check(s) failed.`);
  process.exit(1);
}
console.log('\nInfrastructure static checks passed.');
