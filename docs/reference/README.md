# Reference

Complete API reference for every published `@authwrite` package. These documents cover every type, function, and configuration option — use them for lookup once you are familiar with the concepts in the [Developer Guide](../developer-guide/README.md).

---

| Package | Document | What it covers |
|---|---|---|
| `@authwrite/core` | [core-api.md](core-api.md) | `createAuthEngine`, `createEnforcer`, `evaluate`, `evaluateAll`, `evaluateRead`, `can`, `applyFieldFilter`, and all core types (`Subject`, `Resource`, `AuthContext`, `Decision`, `PolicyDefinition`, `PolicyRule`, `FieldRule`, `AuthObserver`, `PolicyLoader`). |
| `@authwrite/express` | [express-api.md](express-api.md) | `createAuthMiddleware`, `AuthMiddlewareConfig`, resolver signatures, `req.authDecision`, default deny response shape, and `onDeny`. |
| `@authwrite/fastify` | [fastify-api.md](fastify-api.md) | `createAuthHook`, `AuthHookConfig`, resolver signatures, `req.authDecision`, default deny response shape, and `onDeny`. |
| `@authwrite/nextjs` | [nextjs-api.md](nextjs-api.md) | `withAuth`, `WithAuthConfig`, `RouteContext`, resolver signatures, default deny response shape, and `onDeny`. |
| `@authwrite/hono` | [hono-api.md](hono-api.md) | `createAuthMiddleware`, `AuthMiddlewareConfig`, `AUTH_DECISION_KEY`, resolver signatures, default deny response shape, and `onDeny`. |
| `@authwrite/hateoas` | [hateoas-api.md](hateoas-api.md) | `buildLinks`, `embedLinks`, `linksFromDecisions`, `LinkTemplate`, `LinkMap`, and Enforcer mode behaviour. |
| `@authwrite/testing` | [testing-api.md](testing-api.md) | `decisionRecorder`, `DecisionRecorder` methods, `coverageReport`, and `CoverageReport`. |
| `@authwrite/loader-yaml` | [loader-yaml-api.md](loader-yaml-api.md) | `createFileLoader`, `FileLoaderConfig`, `RuleRegistry`, `RuleFn`, the YAML/JSON schema, and `watch` behaviour. |
| `@authwrite/observer-otel` | [observer-otel-api.md](observer-otel-api.md) | `createOtelObserver`, `OtelObserverConfig`, span attributes, metric instruments, and peer dependency requirements. |

© 2026 Devjoy Ltd. MIT License.
