# Observer Redis API Reference

This reference covers `@daltonr/authwrite-observer-redis` — a Redis decision cache observer for `@daltonr/authwrite-core`.

> **Peer dependency.** Requires `ioredis >= 5.0.0`.

---

## `createRedisObserver(config)`

```typescript
export function createRedisObserver(config: RedisObserverConfig): RedisObserver
```

Creates a `RedisObserver` that caches authorization decisions in Redis with TTL. Pass it to `createAuthEngine({ observers })` or `engine.addObserver()`.

On each decision, the result (`allowed` or `denied`) is written to Redis under a key derived from the subject, action, and resource. Entries expire automatically after `ttl` seconds. When the policy is reloaded, all cached decisions are flushed.

```typescript
import { Redis } from 'ioredis'
import { createRedisObserver } from '@daltonr/authwrite-observer-redis'
import { createAuthEngine } from '@daltonr/authwrite-core'

const redis = new Redis(process.env.REDIS_URL)

const redisObserver = createRedisObserver({ client: redis, ttl: 300 })

const engine = createAuthEngine({
  policy,
  observers: [redisObserver],
})

// Before evaluating in hot paths, check the cache first:
const cached = await redisObserver.lookup(userId, 'read', 'document', docId)
if (cached !== null) return cached   // cache hit — skip engine evaluation
return engine.can(subject, resource, 'read')
```

### `RedisObserverConfig`

| Option | Type | Default | Description |
|---|---|---|---|
| `client` | `Redis` | required | An `ioredis` Redis instance. |
| `ttl` | `number` | `300` | Time-to-live for cached decisions, in seconds. |
| `prefix` | `string` | `'authz:'` | Key prefix applied to all cache entries. |
| `onError` | `(err: Error) => void` | — | Called when a Redis operation fails. Omit to silently discard errors. |

---

## `RedisObserver`

```typescript
export interface RedisObserver extends AuthObserver {
  lookup(subjectId, action, resourceType?, resourceId?): Promise<boolean | null>
  invalidate(subjectId?): Promise<void>
  flush(): Promise<void>
}
```

`RedisObserver` extends `AuthObserver` with three additional methods for reading and invalidating the cache.

### `lookup(subjectId, action, resourceType?, resourceId?)`

```typescript
lookup(
  subjectId:     string,
  action:        string,
  resourceType?: string,
  resourceId?:   string,
): Promise<boolean | null>
```

Returns the last cached decision for the given subject/action/resource combination:
- `true` — the decision was `allowed`
- `false` — the decision was `denied`
- `null` — cache miss; no decision has been cached for this combination (or TTL has expired)

### `invalidate(subjectId?)`

```typescript
invalidate(subjectId?: string): Promise<void>
```

Deletes cached decisions for a specific subject (when `subjectId` is provided) or all subjects (when called with no arguments). Uses `SCAN` + `DEL` to avoid blocking Redis.

### `flush()`

```typescript
flush(): Promise<void>
```

Deletes all cached decisions (all keys matching the configured prefix). Called automatically by `onPolicyReload`.

---

## Cache key format

Keys are stored as:

```
{prefix}decision:{subjectId}:{action}:{resourceType}:{resourceId}
```

Missing `resourceType` and `resourceId` are stored as empty strings. Examples:

```
authz:decision:user-123:read:document:doc-456
authz:decision:user-123:login::
```

Values are `'1'` (allowed) or `'0'` (denied), stored as strings.

---

## Behaviour notes

### Fire-and-forget writes

`onDecision` starts the `SET` and returns immediately. A slow or unavailable Redis never adds latency to authorization decisions. Failures are reported through `onError`.

### `onPolicyReload` flushes the cache

When the engine reloads a policy, previously cached decisions may no longer reflect the new rules. `onPolicyReload` calls `flush()` automatically so the next round of decisions is evaluated against the current policy.

### Cache is advisory, not authoritative

The cache stores what the engine decided last time. If you use `lookup` to short-circuit engine evaluation in hot paths, you take responsibility for the staleness window (the `ttl`). The engine itself is always the source of truth.

### SCAN-based invalidation

`invalidate` and `flush` use `SCAN` with a `MATCH` pattern and a `COUNT` hint of 100 to avoid blocking Redis during key enumeration. For large caches, invalidation may take multiple round-trips.

---

## Example — per-request cache check

```typescript
import { Redis } from 'ioredis'
import { createRedisObserver } from '@daltonr/authwrite-observer-redis'
import { createAuthEngine } from '@daltonr/authwrite-core'

const redis = new Redis(process.env.REDIS_URL)

const redisObserver = createRedisObserver({
  client:  redis,
  ttl:     120,
  prefix:  'myapp:authz:',
  onError: (err) => console.error('[observer-redis]', err.message),
})

const engine = createAuthEngine({ policy, observers: [redisObserver] })

// Helper that checks the cache before falling back to full evaluation
async function canFast(subject, resource, action) {
  const cached = await redisObserver.lookup(
    subject.id,
    action,
    resource?.type,
    resource?.id != null ? String(resource.id) : undefined,
  )
  if (cached !== null) return cached
  return engine.can(subject, resource, action)
}
```

---

## Example — invalidate on user role change

```typescript
async function updateUserRoles(userId: string, newRoles: string[]) {
  await db.users.update({ id: userId, roles: newRoles })

  // Clear cached decisions for this user — their permissions may have changed
  await redisObserver.invalidate(userId)
}
```

---

© 2026 Devjoy Ltd. MIT License.
