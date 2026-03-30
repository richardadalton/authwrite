import { useState, useEffect, useRef } from 'react'
import { createAuthEngine, createEnforcer } from '@authwrite/core'
import type { Decision, EnforcerMode } from '@authwrite/core'
import {
  documentPolicy,
  PRESETS,
  INSTANCE_ACTIONS,
} from './policy'
import type { User, Document, Role, Status, Action, Scenario } from './policy'

// ─── Engine + Enforcer (module-level singletons) ──────────────────────────────

const engine   = createAuthEngine({ policy: documentPolicy })
const enforcer = createEnforcer(engine, { mode: 'enforce' })

// ─── Types ────────────────────────────────────────────────────────────────────

interface LogEntry {
  id:       number
  action:   string
  decision: Decision
}

let logId = 0

// ─── App ──────────────────────────────────────────────────────────────────────

export function App() {
  const [role,       setRole]       = useState<Role>('editor')
  const [owns,       setOwns]       = useState(false)
  const [status,     setStatus]     = useState<Status>('draft')
  const [action,     setAction]     = useState<Action>('read')
  const [mode,       setMode]       = useState<EnforcerMode>('enforce')
  const [decision,   setDecision]   = useState<Decision | null>(null)
  const [caps,       setCaps]       = useState<Record<string, Decision>>({})
  const [log,        setLog]        = useState<LogEntry[]>([])
  const [tab,        setTab]        = useState<'decision' | 'policy' | 'log'>('decision')
  const evaluating = useRef(false)

  const isSubjectAction = action === 'change-password'

  // ── Keep enforcer mode in sync ─────────────────────────────────────────────

  useEffect(() => { enforcer.setMode(mode) }, [mode])

  // ── Evaluate on every scenario change ─────────────────────────────────────

  useEffect(() => {
    let cancelled = false

    const subject: User = { id: 'current-user', roles: [role] }
    const resource: Document | undefined = isSubjectAction ? undefined : {
      type:    'document',
      id:      action !== 'create' ? 'doc-1' : undefined,
      ownerId: owns ? 'current-user' : 'other-user',
      status,
    }

    async function evaluate() {
      const d = await enforcer.evaluate({ subject, resource, action })
      if (cancelled) return
      setDecision(d)
      setLog(prev => [{ id: logId++, action, decision: d }, ...prev].slice(0, 100))

      if (!isSubjectAction) {
        const results = await enforcer.evaluateAll({ subject, resource, actions: INSTANCE_ACTIONS })
        if (!cancelled) setCaps(results)
      } else {
        const d2 = await enforcer.evaluate({ subject, action: 'change-password' })
        if (!cancelled) setCaps({ 'change-password': d2 })
      }
    }

    evaluate()
    return () => { cancelled = true }
  }, [role, owns, status, action, mode, isSubjectAction])

  // ── Coverage ──────────────────────────────────────────────────────────────

  const hitRuleIds    = new Set(log.map(e => e.decision.reason).filter(r => r !== 'default'))
  const totalRules    = documentPolicy.rules.length
  const coveragePct   = totalRules === 0 ? 100 : Math.round((hitRuleIds.size / totalRules) * 100)

  // ── Preset loader ─────────────────────────────────────────────────────────

  function applyPreset(p: Scenario) {
    setRole(p.role)
    setOwns(p.owns)
    setStatus(p.status)
    setAction(p.action)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="app">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header>
        <div className="header-title">
          <span className="logo">🔐</span>
          <div>
            <h1>AuthEngine Playground</h1>
            <p className="subtitle">Interactive policy explorer — runs entirely in the browser</p>
          </div>
        </div>
        <div className="mode-toggle">
          <span className="mode-label">Enforcer mode</span>
          {(['enforce', 'audit', 'lockdown'] as EnforcerMode[]).map(m => (
            <button
              key={m}
              className={`mode-btn mode-${m}${mode === m ? ' active' : ''}`}
              onClick={() => setMode(m)}
            >
              {m}
            </button>
          ))}
        </div>
      </header>

      {/* ── Mode banner ─────────────────────────────────────────────────── */}
      {mode === 'audit' && (
        <div className="mode-banner audit">
          ⚠ Audit mode — policy denials are overridden to allow.
          Callers see <code>allowed: true</code>. The decision log shows <code>override: permissive</code>.
          Use this to observe your policy before enforcing it.
        </div>
      )}
      {mode === 'lockdown' && (
        <div className="mode-banner lockdown">
          🔒 Lockdown mode — all access denied regardless of policy.
          The decision log shows <code>override: lockdown</code>.
          Use this to freeze all access in an emergency.
        </div>
      )}

      <main>

        {/* ── Scenario panel ──────────────────────────────────────────────── */}
        <aside className="scenario-panel">
          <section>
            <h2>Presets</h2>
            <div className="presets">
              {PRESETS.map(p => (
                <button
                  key={p.label}
                  className="preset-btn"
                  onClick={() => applyPreset(p)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2>Subject</h2>
            <div className="field-group">
              <label htmlFor="role">Role</label>
              <select id="role" value={role} onChange={e => setRole(e.target.value as Role)}>
                <option value="viewer">viewer</option>
                <option value="editor">editor</option>
                <option value="admin">admin</option>
              </select>
            </div>
            <div className="field-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={owns}
                  disabled={isSubjectAction}
                  onChange={e => setOwns(e.target.checked)}
                />
                Owns this document
              </label>
            </div>
          </section>

          {!isSubjectAction && (
            <section>
              <h2>Resource</h2>
              <div className="field-group">
                <label htmlFor="status">Status</label>
                <select id="status" value={status} onChange={e => setStatus(e.target.value as Status)}>
                  <option value="draft">draft</option>
                  <option value="published">published</option>
                  <option value="archived">archived</option>
                </select>
              </div>
            </section>
          )}

          <section>
            <h2>Action</h2>
            <div className="field-group">
              <select value={action} onChange={e => setAction(e.target.value as Action)}>
                <optgroup label="Instance actions (resource with id)">
                  <option value="read">read</option>
                  <option value="write">write</option>
                  <option value="delete">delete</option>
                </optgroup>
                <optgroup label="Type action (resource without id)">
                  <option value="create">create</option>
                </optgroup>
                <optgroup label="Subject action (no resource)">
                  <option value="change-password">change-password</option>
                </optgroup>
              </select>
            </div>
          </section>
        </aside>

        {/* ── Decision panel ──────────────────────────────────────────────── */}
        <section className="decision-panel">
          <div className="tabs">
            <button className={tab === 'decision' ? 'active' : ''} onClick={() => setTab('decision')}>Decision</button>
            <button className={tab === 'policy'   ? 'active' : ''} onClick={() => setTab('policy')}>Policy</button>
            <button className={tab === 'log'      ? 'active' : ''} onClick={() => setTab('log')}>
              Log {log.length > 0 && <span className="log-count">{log.length}</span>}
            </button>
          </div>

          {/* ── Decision tab ──────────────────────────────────────────────── */}
          {tab === 'decision' && decision && (
            <div className="tab-content">

              <div className={`verdict ${decision.allowed ? 'allowed' : 'denied'}`}>
                <span className="verdict-icon">{decision.allowed ? '✓' : '✗'}</span>
                <span className="verdict-text">{decision.allowed ? 'ALLOWED' : 'DENIED'}</span>
                {decision.override && (
                  <span className="override-badge">override: {decision.override}</span>
                )}
              </div>

              <div className="detail-block">
                <div className="detail-row">
                  <span className="dk">reason</span>
                  <span className={`dv${decision.reason === 'default' ? ' muted' : ' highlight'}`}>
                    {decision.reason}
                    {decision.defaulted && <span className="detail-note"> — no rule matched, defaultEffect applied</span>}
                  </span>
                </div>
                <div className="detail-row">
                  <span className="dk">effect</span>
                  <span className="dv">{decision.effect}</span>
                </div>
                <div className="detail-row">
                  <span className="dk">policy</span>
                  <span className="dv">{decision.policy}</span>
                </div>
                <div className="detail-row">
                  <span className="dk">duration</span>
                  <span className="dv">{decision.durationMs.toFixed(2)}ms</span>
                </div>
                {decision.override && (
                  <div className="detail-row">
                    <span className="dk">override</span>
                    <span className="dv amber">{decision.override}</span>
                  </div>
                )}
              </div>

              {Object.keys(caps).length > 0 && (
                <div className="caps-section">
                  <h3>All capabilities</h3>
                  <div className="cap-grid">
                    {Object.entries(caps).map(([act, d]) => (
                      <div
                        key={act}
                        className={`cap-row ${d.allowed ? 'allowed' : 'denied'}${act === action ? ' selected' : ''}`}
                        onClick={() => setAction(act as Action)}
                        title="Click to select"
                      >
                        <span className="cap-icon">{d.allowed ? '✓' : '✗'}</span>
                        <span className="cap-action">{act}</span>
                        <span className="cap-reason">{d.reason}</span>
                        {d.override && <span className="cap-override">{d.override}</span>}
                      </div>
                    ))}
                  </div>
                  <p className="caps-hint">Click a row to evaluate that action</p>
                </div>
              )}
            </div>
          )}

          {/* ── Policy tab ────────────────────────────────────────────────── */}
          {tab === 'policy' && (
            <div className="tab-content">
              <div className="policy-meta">
                <span className="badge mono">id: documents</span>
                <span className="badge mono">version: 1.0.0</span>
                <span className="badge deny">defaultEffect: deny</span>
              </div>

              <div className="rules-list">
                {documentPolicy.rules.map(rule => {
                  const isActive = decision?.reason === rule.id
                  const wasHit   = hitRuleIds.has(rule.id)
                  return (
                    <div
                      key={rule.id}
                      className={`rule-card${isActive ? ' active' : ''}${wasHit && !isActive ? ' hit' : ''}`}
                    >
                      <div className="rule-header">
                        <span className="rule-id">{rule.id}</span>
                        <div className="rule-badges">
                          {isActive && <span className="badge active-badge">decided this</span>}
                          {wasHit && !isActive && <span className="badge hit-badge">fired</span>}
                          <span className="badge mono">priority {rule.priority ?? 0}</span>
                        </div>
                      </div>
                      <p className="rule-desc">{rule.description}</p>
                      <div className="rule-effects">
                        {rule.allow && (
                          <span className="badge allow">allow: [{rule.allow.join(', ')}]</span>
                        )}
                        {rule.deny && (
                          <span className="badge deny">deny: [{rule.deny.join(', ')}]</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="policy-note">
                <p>
                  Rules are plain TypeScript — no DSL, no schema, full IDE support.
                  The <code>match</code> function receives the full <code>AuthContext</code> and returns a boolean.
                  Every decision comes back with the <strong>reason</strong> field set to the winning rule's ID.
                </p>
              </div>
            </div>
          )}

          {/* ── Log tab ───────────────────────────────────────────────────── */}
          {tab === 'log' && (
            <div className="tab-content">
              <div className="coverage-row">
                <span className="coverage-label">Rules fired</span>
                <div className="coverage-bar">
                  <div className="coverage-fill" style={{ width: `${coveragePct}%` }} />
                </div>
                <span className="coverage-pct">{hitRuleIds.size}/{totalRules} ({coveragePct}%)</span>
              </div>

              {log.length === 0 ? (
                <p className="empty">No decisions yet. Change any control to evaluate.</p>
              ) : (
                <div className="log-list">
                  {log.map(entry => (
                    <div key={entry.id} className={`log-entry ${entry.decision.allowed ? 'allowed' : 'denied'}`}>
                      <span className="log-icon">{entry.decision.allowed ? '✓' : '✗'}</span>
                      <span className="log-action">{entry.action}</span>
                      <span className="log-reason">{entry.decision.reason}</span>
                      {entry.decision.override && (
                        <span className="log-override">{entry.decision.override}</span>
                      )}
                      <span className="log-dur">{entry.decision.durationMs.toFixed(2)}ms</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </main>

      <footer>
        <a href="https://github.com/richardadalton/authwrite" target="_blank" rel="noopener noreferrer">
          github.com/richardadalton/authwrite
        </a>
        <span>·</span>
        <span>@authwrite/core — zero dependencies</span>
        <span>·</span>
        <span>MIT License</span>
      </footer>
    </div>
  )
}
