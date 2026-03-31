import type {
  AuthContext,
  AuthObserver,
  DecisionEvent,
  PolicyDefinition,
} from '@daltonr/authwrite-core'
import type { Redis } from 'ioredis'

// ─── Config ───────────────────────────────────────────────────────────────────

export interface RedisObserverConfig {
  /** An `ioredis` Redis instance. */
  client: Redis
  /**
   * TTL for cached decisions, in seconds.
   * @default 300
   */
  ttl?: number
  /**
   * Key prefix for all cache entries.
   * @default 'authz:'
   */
  prefix?: string
  /**
   * Called when a Redis operation fails. If omitted, errors are silently
   * discarded so a slow or unavailable Redis never blocks request handling.
   */
  onError?: (err: Error) => void
}

// ─── Observer interface ───────────────────────────────────────────────────────

export interface RedisObserver extends AuthObserver {
  /**
   * Looks up the last cached decision for a subject/action/resource combination.
   * Returns `true` (allowed), `false` (denied), or `null` (cache miss).
   */
  lookup(
    subjectId:    string,
    action:       string,
    resourceType?: string,
    resourceId?:   string,
  ): Promise<boolean | null>

  /**
   * Deletes all cached decisions for a specific subject, or for all subjects
   * when called with no arguments.
   */
  invalidate(subjectId?: string): Promise<void>

  /**
   * Deletes all cached decisions (all keys matching the configured prefix).
   * Called automatically on `onPolicyReload`.
   */
  flush(): Promise<void>
}

// ─── Key helpers ──────────────────────────────────────────────────────────────

function decisionKey(
  prefix:       string,
  subjectId:    string,
  action:       string,
  resourceType: string,
  resourceId:   string,
): string {
  return `${prefix}decision:${subjectId}:${action}:${resourceType}:${resourceId}`
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createRedisObserver(config: RedisObserverConfig): RedisObserver {
  const prefix = config.prefix ?? 'authz:'
  const ttl    = config.ttl    ?? 300

  // ─── Cache writes ──────────────────────────────────────────────────────────

  function onDecision({ decision }: DecisionEvent): void {
    const { context: ctx, allowed } = decision
    const key = decisionKey(
      prefix,
      ctx.subject.id,
      ctx.action,
      ctx.resource?.type ?? '',
      ctx.resource?.id !== undefined ? String(ctx.resource.id) : '',
    )
    config.client.set(key, allowed ? '1' : '0', 'EX', ttl).catch((err: unknown) => {
      config.onError?.(err instanceof Error ? err : new Error(String(err)))
    })
  }

  function onError(_err: Error, _ctx: AuthContext): void {
    // Engine evaluation errors don't affect the cache.
  }

  function onPolicyReload(_policy: PolicyDefinition): void {
    // When the policy changes, cached decisions may no longer reflect the new
    // policy. Flush everything so the next evaluation hits the engine fresh.
    flush().catch((err: unknown) => {
      config.onError?.(err instanceof Error ? err : new Error(String(err)))
    })
  }

  // ─── Cache reads ───────────────────────────────────────────────────────────

  async function lookup(
    subjectId:     string,
    action:        string,
    resourceType?: string,
    resourceId?:   string,
  ): Promise<boolean | null> {
    const key = decisionKey(prefix, subjectId, action, resourceType ?? '', resourceId ?? '')
    const value = await config.client.get(key)
    if (value === null) return null
    return value === '1'
  }

  // ─── Cache invalidation ────────────────────────────────────────────────────

  async function invalidate(subjectId?: string): Promise<void> {
    const pattern = subjectId
      ? `${prefix}decision:${subjectId}:*`
      : `${prefix}decision:*`
    await scanAndDelete(pattern)
  }

  async function flush(): Promise<void> {
    await scanAndDelete(`${prefix}decision:*`)
  }

  async function scanAndDelete(pattern: string): Promise<void> {
    let cursor = '0'
    do {
      const [nextCursor, keys] = await config.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
      cursor = nextCursor
      if (keys.length > 0) {
        await config.client.del(...keys)
      }
    } while (cursor !== '0')
  }

  return { onDecision, onError, onPolicyReload, lookup, invalidate, flush }
}
