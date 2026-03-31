import type {
  AuthContext,
  AuthObserver,
  DecisionEvent,
  PolicyDefinition,
} from '@daltonr/authwrite-core'

// ─── Config ───────────────────────────────────────────────────────────────────

/**
 * Minimal duck-typed interface for a pg Pool or Client.
 * Accepts any object whose `query` method matches the pg API.
 */
export interface QueryClient {
  query(text: string, values?: unknown[]): Promise<unknown>
}

export interface PgObserverConfig {
  /** A `pg.Pool` or `pg.Client` instance — or any object with a compatible `query` method. */
  client: QueryClient
  /**
   * Name of the table to write audit records to.
   * Must match `[a-zA-Z_][a-zA-Z0-9_]*` or `schema.table` form.
   * @default 'authz_decisions'
   */
  table?: string
  /**
   * Called when a database write fails. If omitted, errors are silently
   * discarded so a slow or unavailable database never blocks request handling.
   */
  onError?: (err: Error) => void
}

// ─── SQL ──────────────────────────────────────────────────────────────────────
//
// Required table schema (run once during setup):
//
//   CREATE TABLE authz_decisions (
//     id            bigserial    PRIMARY KEY,
//     decided_at    timestamptz  NOT NULL DEFAULT now(),
//     subject_id    text         NOT NULL,
//     resource_type text,
//     resource_id   text,
//     action        text         NOT NULL,
//     policy_id     text         NOT NULL,
//     allowed       boolean      NOT NULL,
//     reason        text         NOT NULL,
//     defaulted     boolean      NOT NULL DEFAULT false,
//     duration_ms   real         NOT NULL,
//     override      text,
//     error_message text,
//     source        text,
//     subject       jsonb,
//     resource      jsonb
//   );
//
//   CREATE INDEX ON authz_decisions (subject_id, action);
//   CREATE INDEX ON authz_decisions (decided_at);

// ─── Validation ───────────────────────────────────────────────────────────────

const TABLE_RE = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$/

function validateTable(name: string): void {
  if (!TABLE_RE.test(name)) {
    throw new Error(
      `Invalid table name: "${name}". ` +
      `Use identifier characters only (e.g. "authz_decisions" or "public.authz_decisions").`
    )
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createPgObserver(config: PgObserverConfig): AuthObserver {
  const table = config.table ?? 'authz_decisions'
  validateTable(table)

  // Build the INSERT once — the table name is validated above, so interpolation is safe.
  const INSERT_SQL = `
    INSERT INTO ${table}
      (subject_id, resource_type, resource_id, action, policy_id, allowed,
       reason, defaulted, duration_ms, override, error_message, source, subject, resource)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
  `

  function onDecision({ decision, source }: DecisionEvent): void {
    const { context: ctx, allowed, reason, policy, durationMs, override, defaulted, error } = decision

    const values: unknown[] = [
      ctx.subject.id,
      ctx.resource?.type ?? null,
      ctx.resource?.id   !== undefined ? String(ctx.resource.id) : null,
      ctx.action,
      policy,
      allowed,
      reason,
      defaulted,
      durationMs,
      override      ?? null,
      error?.message ?? null,
      source        ?? null,
      JSON.stringify(ctx.subject),
      ctx.resource ? JSON.stringify(ctx.resource) : null,
    ]

    config.client.query(INSERT_SQL, values).catch((err: unknown) => {
      config.onError?.(err instanceof Error ? err : new Error(String(err)))
    })
  }

  function onError(err: Error, _ctx: AuthContext): void {
    // Engine evaluation errors are surfaced to the caller via the engine's
    // error handling. Pass them through to the user's error handler if provided.
    config.onError?.(err)
  }

  function onPolicyReload(_policy: PolicyDefinition): void {
    // No-op — this observer is an append-only audit log.
    // Each future decision will simply be written with the new policy_id.
  }

  return { onDecision, onError, onPolicyReload }
}
