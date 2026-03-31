# Installation

Authwrite ships as a family of focused packages. The core package has zero runtime dependencies. Optional packages add framework adapters, loaders, observability, and testing utilities.

## Packages

| Package | Description |
| --- | --- |
| `@authwrite/core` | Zero-dependency engine, evaluator, and all types |
| `@authwrite/testing` | `decisionRecorder` and `coverageReport` for policy testing |
| `@authwrite/express` | Express middleware adapter |
| `@authwrite/fastify` | Fastify pre-handler hook adapter |
| `@authwrite/nextjs` | Next.js App Router route handler wrapper |
| `@authwrite/hono` | Hono middleware adapter (edge-runtime compatible) |
| `@authwrite/hateoas` | Permission-aware hypermedia link building (HAL `_links`) |
| `@authwrite/loader-yaml` | YAML/JSON file-based policy loader |
| `@authwrite/observer-otel` | OpenTelemetry spans and metrics observer |

---

## Step 1 — Install the core package

```bash
npm install @authwrite/core
```

`@authwrite/core` is the only required package. Everything else is optional and additive.

---

## Step 2 — Install optional packages

Add whichever extras your project needs.

```bash
# Policy testing utilities
npm install --save-dev @authwrite/testing

# Framework adapters
npm install @authwrite/express
npm install @authwrite/fastify
npm install @authwrite/nextjs
npm install @authwrite/hono

# HATEOAS hypermedia links
npm install @authwrite/hateoas

# Load policies from YAML or JSON files
npm install @authwrite/loader-yaml

# OpenTelemetry observability
npm install @authwrite/observer-otel
```

---

## Peer dependencies

Some packages require peers that your project must supply.

| Package | Peer dependency | Version |
| --- | --- | --- |
| `@authwrite/express` | `express` | `^4.0 \|\| ^5.0` |
| `@authwrite/fastify` | `fastify` | `^4.0 \|\| ^5.0` |
| `@authwrite/nextjs` | none | — |
| `@authwrite/hono` | `hono` | `^4.0` |
| `@authwrite/hateoas` | none | — |
| `@authwrite/observer-otel` | `@opentelemetry/api` | `^1.0` |
| `@authwrite/loader-yaml` | `js-yaml` | `^4.0` |
| `@authwrite/testing` | `vitest` or `jest` | any |

`@authwrite/core`, `@authwrite/nextjs`, and `@authwrite/hateoas` have no peer dependencies.

---

## Verification

Once installed, confirm everything is wired correctly by creating an engine with a minimal policy and evaluating a decision.

```typescript
import { createAuthEngine } from '@authwrite/core'

const engine = createAuthEngine({
  policy: {
    id: 'smoke-test',
    defaultEffect: 'deny',
    rules: [
      {
        id: 'allow-read',
        match: (ctx) => ctx.action === 'read',
        allow: ['read'],
      },
    ],
  },
})

const decision = await engine.evaluate({
  subject: { id: 'user-1', roles: ['viewer'] },
  action: 'read',
})

console.log(decision.allowed)  // true
console.log(decision.reason)   // 'allow-read'
```

A few things to notice:

- `defaultEffect: 'deny'` means any action not matched by a rule is denied. This is the recommended default.
- `reason` is the `id` of the rule that decided, or `'default'` when no rule matched and the `defaultEffect` was applied.
- `evaluate` is async — the engine supports async condition functions and observer hooks.

---

## TypeScript

All packages are written in TypeScript and ship their own type declarations. No `@types/*` package is needed for any `@authwrite/*` package.

The minimum supported TypeScript version is **5.0**.

---

## Node and runtime support

| Runtime | Minimum version |
| --- | --- |
| Node.js | 18 |
| Deno | 1.40 |
| Bun | 1.0 |
| Browser (bundled) | ES2020 target |

---

© 2026 Devjoy Ltd. MIT License.
