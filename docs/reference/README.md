# Reference

Complete API reference for every published `@authwrite` package. These documents cover every type, function, and configuration option — use them for lookup once you are familiar with the concepts in the [Developer Guide](../developer-guide/README.md).

---

| Package | Document | What it covers |
|---|---|---|
| `@daltonr/authwrite-core` | [core-api.md](core-api.md) | `createAuthEngine`, `evaluatePolicy`, `fromLoader`, `intersect`, `union`, `firstMatch`, `evaluate`, `evaluateAll`, `evaluateRead`, `can`, `permissions`, `applyFieldFilter`, and all core types (`Subject`, `Resource`, `AuthContext`, `Decision`, `PolicyDefinition`, `PolicyRule`, `FieldRule`, `AuthObserver`, `PolicyLoader`, `PolicyResolver`). |
| `@daltonr/authwrite-express` | [express-api.md](express-api.md) | `createExpressAuth`, `createAuthMiddleware`, `ExpressAuthConfig`, `AuthMiddlewareConfig`, resolver signatures, `req.authDecision`, default deny response shape, and `onDeny`. |
| `@daltonr/authwrite-fastify` | [fastify-api.md](fastify-api.md) | `createAuthHook`, `AuthHookConfig`, resolver signatures, `req.authDecision`, default deny response shape, and `onDeny`. |
| `@daltonr/authwrite-nextjs` | [nextjs-api.md](nextjs-api.md) | `withAuth`, `WithAuthConfig`, `RouteContext`, resolver signatures, default deny response shape, and `onDeny`. |
| `@daltonr/authwrite-hono` | [hono-api.md](hono-api.md) | `createAuthMiddleware`, `AuthMiddlewareConfig`, `AUTH_DECISION_KEY`, resolver signatures, default deny response shape, and `onDeny`. |
| `@daltonr/authwrite-hateoas` | [hateoas-api.md](hateoas-api.md) | `buildLinks`, `embedLinks`, `linksFromDecisions`, `LinkTemplate`, `LinkMap`, and Enforcer mode behaviour. |
| `@daltonr/authwrite-testing` | [testing-api.md](testing-api.md) | `decisionRecorder`, `DecisionRecorder` methods, `coverageReport`, and `CoverageReport`. |
| `@daltonr/authwrite-loader-yaml` | [loader-yaml-api.md](loader-yaml-api.md) | `createFileLoader`, `FileLoaderConfig`, `RuleRegistry`, `RuleFn`, the YAML/JSON schema, and `watch` behaviour. |
| `@daltonr/authwrite-loader-db` | [loader-db-api.md](loader-db-api.md) | `createDbLoader`, `DbLoaderConfig`, `RuleRegistry`, `RuleFn`, the serializable policy schema, and polling behaviour. |
| `@daltonr/authwrite-observer-otel` | [observer-otel-api.md](observer-otel-api.md) | `createOtelObserver`, `OtelObserverConfig`, span attributes, metric instruments, and peer dependency requirements. |
| `@daltonr/authwrite-observer-pg` | [observer-pg-api.md](observer-pg-api.md) | `createPgObserver`, `PgObserverConfig`, `QueryClient`, table schema, column reference, and fire-and-forget write behaviour. |
| `@daltonr/authwrite-observer-redis` | [observer-redis-api.md](observer-redis-api.md) | `createRedisObserver`, `RedisObserverConfig`, `RedisObserver`, `lookup`, `invalidate`, `flush`, cache key format, and TTL behaviour. |
| `@daltonr/authwrite-devtools` | [devtools-api.md](devtools-api.md) | `createDevTools`, `DevToolsObserver`, `createDevServer`, `PolicySwitcherOptions`, decision flagging, `PersistedDecision`, `DecisionFlag`, and dev server endpoints. |
| `@daltonr/authwrite-rulewrite` | [rulewrite-api.md](rulewrite-api.md) | `fromRule`, `EvaluatableRule`, `RuleMatchFns`, and `Decision.matchExplanation`. |

© 2026 Devjoy Ltd. MIT License.
