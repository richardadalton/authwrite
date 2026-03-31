// Browser sidebar injected via:
//   <script src="http://localhost:PORT/devtools-client.js"></script>
//
// The build step replaces __DEVTOOLS_PORT__ with the real port number.
// The server also patches it at serve-time as a fallback.

declare const __DEVTOOLS_PORT__: number
const PORT = typeof __DEVTOOLS_PORT__ !== 'undefined' ? __DEVTOOLS_PORT__ : 4999

// ─── Types ────────────────────────────────────────────────────────────────────

interface PersistedDecision {
  id:         string
  timestamp:  number
  subject:    Record<string, unknown>
  resource?:  Record<string, unknown>
  action:     string
  policy:     string
  effect:     'allow' | 'deny'
  allowed:    boolean
  reason:     string
  defaulted:  boolean
  durationMs: number
  override?:  'permissive' | 'suspended' | 'lockdown'
}

// ─── State ────────────────────────────────────────────────────────────────────

let decisions: PersistedDecision[] = []
let expandedId: string | null      = null
let flaggingId: string | null      = null
let collapsed                      = false
let flagCount                      = 0
let connected                      = false

const sections: Record<string, boolean> = { decisions: true, policy: false }

let policyFiles:     string[]  = []
let policyFetched              = false
let policyApplying             = false
let policyStatus:    string    = ''
let policyStatusOk             = false

// ─── DOM refs (set in mount()) ────────────────────────────────────────────────

let shadow:          ShadowRoot
let listEl:          HTMLElement
let badgeEl:         HTMLElement
let statusDotEl:     HTMLElement
let statusTxtEl:     HTMLElement
let toggleTabEl:     HTMLButtonElement
let policyBodyEl:    HTMLElement

// ─── Rendering ────────────────────────────────────────────────────────────────

function render() {
  if (!listEl) return

  if (decisions.length === 0) {
    listEl.innerHTML = `
      <div class="empty">
        <div class="empty-glyph">◊</div>
        <div>Waiting for decisions…</div>
        <div class="empty-hint">Start making requests in your app.</div>
      </div>`
    return
  }

  listEl.innerHTML = decisions
    .slice().reverse()
    .map(renderDecision)
    .join('')
}

function renderDecision(d: PersistedDecision): string {
  const isExpanded = expandedId === d.id
  const isFlagging = flaggingId === d.id

  // In audit/suspended/lockdown mode the policy effect can differ from the final outcome
  const policyDenied  = d.effect === 'deny'
  const finalAllowed  = d.allowed
  const hasOverride   = !!d.override

  // Colour reflects the real policy decision, not the enforcer override
  const policyColor   = policyDenied  ? 'var(--denied)'  : 'var(--allowed)'
  const outcomeColor  = finalAllowed  ? 'var(--allowed)' : 'var(--denied)'
  const policyLabel   = policyDenied  ? 'DENY'           : 'ALLOW'
  const outcomeLabel  = finalAllowed  ? 'ALLOWED'        : 'DENIED'

  const overridePill = hasOverride
    ? `<span class="override-pill override--${d.override}">${d.override}</span>`
    : ''

  const resourceStr = d.resource
    ? `${(d.resource as {type?:string}).type ?? 'resource'}:${(d.resource as {id?:string}).id ?? ''}`
    : '—'

  return `
    <div class="decision${isExpanded ? ' decision--open' : ''}" data-id="${d.id}">
      <div class="decision-row" data-action="toggle" data-id="${d.id}">
        <span class="dot" style="background:${policyColor}"></span>
        <span class="verdict" style="color:${policyColor}">${policyLabel}</span>
        ${hasOverride ? `<span class="arrow">→</span><span class="outcome" style="color:${outcomeColor}">${outcomeLabel}</span>` : ''}
        ${overridePill}
        <span class="action-name">${d.action}</span>
        <span class="resource-name">${resourceStr}</span>
        <span class="ts">${formatTime(d.timestamp)}</span>
      </div>
      <div class="decision-sub">
        <span class="subject-id">${(d.subject as {id?:string}).id ?? 'unknown'}</span>
        <span class="rule-id">${d.reason}</span>
        ${d.defaulted ? '<span class="defaulted">defaulted</span>' : ''}
      </div>
      ${isExpanded ? renderDetail(d, isFlagging) : ''}
    </div>`
}

function renderDetail(d: PersistedDecision, isFlagging: boolean): string {
  const rows = [
    row('subject',  JSON.stringify(d.subject,  null, 2)),
    d.resource ? row('resource', JSON.stringify(d.resource, null, 2)) : '',
    row('action',   d.action),
    row('policy',   d.policy),
    row('effect',   `<span style="color:${d.effect==='deny'?'var(--denied)':'var(--allowed)'}">${d.effect}</span>`),
    row('allowed',  `<span style="color:${d.allowed?'var(--allowed)':'var(--denied)'}">${d.allowed}</span>`),
    row('reason',   d.reason),
    d.override ? row('override', `<span class="override-pill override--${d.override}">${d.override}</span>`) : '',
    row('ms',       `${d.durationMs.toFixed(2)} ms`),
  ].filter(Boolean).join('')

  const flagSection = isFlagging
    ? renderFlagForm(d)
    : `<button class="btn btn--ghost flag-open-btn" data-action="flag-open" data-id="${d.id}">Flag as wrong</button>`

  return `<div class="detail"><div class="detail-rows">${rows}</div>${flagSection}</div>`
}

function row(label: string, value: string): string {
  return `<div class="row"><span class="row-label">${label}</span><span class="row-val">${value}</span></div>`
}

function renderFlagForm(d: PersistedDecision): string {
  const oppositeVerdict = d.effect === 'deny'  ? 'should-allow' : 'should-deny'
  const oppositeLabel   = d.effect === 'deny'  ? 'ALLOWED'      : 'DENIED'

  return `
    <div class="flag-form">
      <div class="flag-title">Flag this decision</div>
      <label class="flag-radio">
        <input type="radio" name="flag-verdict-${d.id}" value="${oppositeVerdict}" checked>
        Policy said <strong>${d.effect.toUpperCase()}</strong> but it should be <strong>${oppositeLabel}</strong>
      </label>
      <textarea class="flag-note" placeholder="Notes (optional)…" rows="2" id="flag-note-${d.id}"></textarea>
      <div class="flag-btns">
        <button class="btn btn--primary" data-action="flag-submit" data-id="${d.id}">Submit flag</button>
        <button class="btn btn--ghost"   data-action="flag-cancel" data-id="${d.id}">Cancel</button>
      </div>
    </div>`
}

// ─── Policy section ───────────────────────────────────────────────────────────

function renderPolicySection() {
  if (!policyBodyEl) return

  if (!policyFetched) {
    policyBodyEl.innerHTML = `<div class="policy-loading">Loading…</div>`
    return
  }

  if (policyFiles.length === 0) {
    policyBodyEl.innerHTML = `<div class="policy-empty">No policy files found.<br>Configure a <code>policies.dir</code> in devtools options.</div>`
    return
  }

  const options = policyFiles.map(f =>
    `<option value="${f}">${f}</option>`
  ).join('')

  const statusHtml = policyStatus
    ? `<span class="policy-status ${policyStatusOk ? 'policy-status--ok' : 'policy-status--err'}">${policyStatus}</span>`
    : ''

  policyBodyEl.innerHTML = `
    <label class="policy-label">Policy file</label>
    <select class="policy-select" id="aw-policy-select">
      <option value="">— select —</option>
      ${options}
    </select>
    <div class="policy-actions">
      <button class="btn btn--apply${policyApplying ? ' btn--applying' : ''}" data-action="policy-apply" ${policyApplying ? 'disabled' : ''}>
        ${policyApplying ? 'Applying…' : 'Apply'}
      </button>
      ${statusHtml}
    </div>`
}

function fetchPolicies() {
  fetch(`http://localhost:${PORT}/policies`)
    .then(r => r.json())
    .then((data: { configured: boolean; files: string[] }) => {
      policyFiles   = data.files ?? []
      policyFetched = true
      renderPolicySection()
    })
    .catch(() => {
      policyFiles   = []
      policyFetched = true
      policyStatus  = 'Could not reach server'
      policyStatusOk = false
      renderPolicySection()
    })
}

function applyPolicy() {
  const selectEl = shadow.getElementById('aw-policy-select') as HTMLSelectElement | null
  const file     = selectEl?.value ?? ''
  if (!file) return

  policyApplying = true
  policyStatus   = ''
  renderPolicySection()

  fetch(`http://localhost:${PORT}/policies/apply`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ file }),
  })
    .then(r => r.json())
    .then((data: { ok?: boolean; error?: string }) => {
      policyApplying = false
      if (data.ok) {
        policyStatus   = `✓ Applied ${file}`
        policyStatusOk = true
      } else {
        policyStatus   = `✗ ${data.error ?? 'Failed'}`
        policyStatusOk = false
      }
      renderPolicySection()
    })
    .catch(() => {
      policyApplying = false
      policyStatus   = '✗ Request failed'
      policyStatusOk = false
      renderPolicySection()
    })
}

function toggleSection(name: string) {
  sections[name] = !sections[name]

  const body    = shadow.getElementById(`aw-section-body-${name}`)
  const chevron = shadow.getElementById(`aw-chevron-${name}`)
  if (!body || !chevron) return

  if (sections[name]) {
    body.style.display  = ''
    chevron.textContent = '▼'
  } else {
    body.style.display  = 'none'
    chevron.textContent = '▶'
  }

  // Lazy-load policy files on first open
  if (name === 'policy' && sections[name] && !policyFetched) {
    fetchPolicies()
  }
}

// ─── Event handling ───────────────────────────────────────────────────────────

function handleClick(e: Event) {
  const target    = e.target as HTMLElement
  const actionEl  = target.closest('[data-action]') as HTMLElement | null
  if (!actionEl) return

  const action = actionEl.dataset['action']
  const id     = actionEl.dataset['id']

  switch (action) {
    case 'toggle':
      if (id) {
        expandedId = expandedId === id ? null : id
        flaggingId = null
        render()
      }
      break

    case 'flag-open':
      if (id) {
        flaggingId = id
        render()
      }
      break

    case 'flag-cancel':
      flaggingId = null
      render()
      break

    case 'flag-submit':
      if (id) submitFlag(id)
      break

    case 'clear':
      decisions  = []
      expandedId = null
      flaggingId = null
      render()
      break

    case 'toggle-sidebar':
      toggleSidebar()
      break

    case 'toggle-section': {
      const section = actionEl.dataset['section']
      if (section) toggleSection(section)
      break
    }

    case 'policy-apply':
      applyPolicy()
      break
  }
}

function toggleSidebar() {
  collapsed = !collapsed
  const sidebar = shadow.getElementById('aw-sidebar')!
  if (collapsed) {
    sidebar.classList.add('sidebar--collapsed')
    toggleTabEl.style.right = '0'
  } else {
    sidebar.classList.remove('sidebar--collapsed')
    toggleTabEl.style.right = 'var(--sidebar-w)'
  }
}

function submitFlag(id: string) {
  const noteEl    = shadow.getElementById(`flag-note-${id}`) as HTMLTextAreaElement | null
  const radioEl   = shadow.querySelector(`input[name="flag-verdict-${id}"]:checked`) as HTMLInputElement | null
  const note      = noteEl?.value ?? ''
  const verdict   = radioEl?.value ?? ''

  fetch(`http://localhost:${PORT}/flag`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ id, verdict, note }),
  }).catch(() => { /* best-effort */ })

  flaggingId = null
  flagCount++
  badgeEl.textContent = String(flagCount)
  badgeEl.classList.add('badge--visible')
  render()
}

// ─── SSE connection ───────────────────────────────────────────────────────────

function connect() {
  const es = new EventSource(`http://localhost:${PORT}/events`)

  es.onopen = () => {
    connected = true
    statusDotEl.classList.add('dot--connected')
    statusTxtEl.textContent = `localhost:${PORT}`
  }

  es.onmessage = (e) => {
    try {
      const d: PersistedDecision = JSON.parse(e.data as string)
      decisions.push(d)
      if (decisions.length > 500) decisions.shift()
      render()
      // Auto-scroll list to top (newest decisions are rendered first)
      listEl.scrollTop = 0
    } catch { /* ignore malformed messages */ }
  }

  es.onerror = () => {
    connected = false
    statusDotEl.classList.remove('dot--connected')
    statusTxtEl.textContent = 'Disconnected — retrying…'
  }
}

// ─── Mount ────────────────────────────────────────────────────────────────────

function mount() {
  if (document.getElementById('__aw_devtools__')) return // already mounted

  const host = document.createElement('div')
  host.id    = '__aw_devtools__'
  Object.assign(host.style, {
    position:      'fixed',
    top:           '0',
    right:         '0',
    height:        '100vh',
    width:         '360px',   // sidebar (340px) + toggle tab overlap (20px)
    zIndex:        '999999',
    pointerEvents: 'none',
  })
  document.body.appendChild(host)

  shadow = host.attachShadow({ mode: 'open' })

  const styleEl = document.createElement('style')
  styleEl.textContent = CSS
  shadow.appendChild(styleEl)

  const wrap = document.createElement('div')
  wrap.innerHTML = TEMPLATE
  shadow.appendChild(wrap)

  // Wire refs
  listEl       = shadow.getElementById('aw-section-body-decisions')!
  badgeEl      = shadow.getElementById('aw-badge')!
  statusDotEl  = shadow.getElementById('aw-status-dot')!
  statusTxtEl  = shadow.getElementById('aw-status-txt')!
  toggleTabEl  = shadow.getElementById('aw-toggle')! as HTMLButtonElement
  policyBodyEl = shadow.getElementById('aw-section-body-policy')!

  toggleTabEl.addEventListener('click', toggleSidebar)
  shadow.addEventListener('click', handleClick)

  render()
  connect()
}

// ─── HTML template ────────────────────────────────────────────────────────────

const TEMPLATE = `
  <div id="aw-sidebar" class="sidebar">

    <div class="header">
      <span class="logo">◊</span>
      <span class="header-title">Authwrite DevTools</span>
    </div>

    <div class="section-header" data-action="toggle-section" data-section="decisions">
      <span class="section-chevron" id="aw-chevron-decisions">▼</span>
      <span class="section-title">Decisions</span>
      <span class="badge" id="aw-badge"></span>
      <button class="btn btn--ghost btn--sm" data-action="clear">clear</button>
    </div>
    <div class="section-body section-body--decisions" id="aw-section-body-decisions"></div>

    <div class="section-header" data-action="toggle-section" data-section="policy">
      <span class="section-chevron" id="aw-chevron-policy">▶</span>
      <span class="section-title">Policy</span>
    </div>
    <div class="section-body section-body--policy" id="aw-section-body-policy" style="display:none"></div>

    <div class="status">
      <div class="dot" id="aw-status-dot"></div>
      <span id="aw-status-txt">Connecting…</span>
    </div>

  </div>
  <button id="aw-toggle" class="toggle-tab" style="right: var(--sidebar-w)">DevTools</button>
`

// ─── CSS (shadow DOM scope) ───────────────────────────────────────────────────

const CSS = `
  :host { all: initial; }

  *, *::before, *::after { box-sizing: border-box; }

  :root, div {
    --sidebar-w:  340px;
    --bg:         #0f172a;
    --bg-deep:    #0a0f1e;
    --bg-hover:   #1e293b;
    --bg-detail:  #0d1b2a;
    --border:     #1e293b;
    --text:       #e2e8f0;
    --muted:      #94a3b8;
    --dim:        #475569;
    --allowed:    #10b981;
    --denied:     #ef4444;
    --audit:      #f59e0b;
    --suspended:  #8b5cf6;
    --lockdown:   #dc2626;
    --font:       ui-monospace, 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  }

  /* ── Sidebar panel ── */

  .sidebar {
    position:        absolute;
    top:             0;
    right:           0;
    width:           var(--sidebar-w);
    height:          100vh;
    background:      var(--bg);
    border-left:     1px solid var(--border);
    display:         flex;
    flex-direction:  column;
    font-family:     var(--font);
    font-size:       12px;
    color:           var(--text);
    box-shadow:      -4px 0 32px rgba(0,0,0,0.5);
    pointer-events:  all;
    transition:      transform 0.2s ease;
  }

  .sidebar--collapsed {
    transform: translateX(var(--sidebar-w));
  }

  /* ── Toggle tab ── */

  .toggle-tab {
    position:        fixed;
    top:             50%;
    transform:       translateY(-50%);
    background:      #10b981;
    color:           #fff;
    border:          none;
    border-radius:   6px 0 0 6px;
    padding:         10px 5px;
    cursor:          pointer;
    font-size:       10px;
    font-family:     var(--font);
    letter-spacing:  1.5px;
    writing-mode:    vertical-lr;
    text-orientation: mixed;
    z-index:         1;
    pointer-events:  all;
    transition:      right 0.2s ease;
    user-select:     none;
  }

  .toggle-tab:hover {
    background: #059669;
  }

  /* ── Header ── */

  .header {
    display:         flex;
    align-items:     center;
    gap:             8px;
    padding:         10px 12px;
    border-bottom:   1px solid var(--border);
    flex-shrink:     0;
  }

  .logo {
    color:        var(--allowed);
    font-size:    16px;
    line-height:  1;
  }

  .header-title {
    color:       #f1f5f9;
    font-weight: 600;
    font-size:   12px;
    flex:        1;
  }

  /* ── Sections ── */

  .section-header {
    display:       flex;
    align-items:   center;
    gap:           7px;
    padding:       6px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink:   0;
    cursor:        pointer;
    user-select:   none;
    background:    var(--bg-deep);
  }

  .section-header:hover { background: var(--bg-hover); }

  .section-chevron {
    color:       var(--dim);
    font-size:   9px;
    flex-shrink: 0;
    width:       10px;
  }

  .section-title {
    color:          var(--muted);
    font-size:      10px;
    font-weight:    600;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    flex:           1;
  }

  .badge {
    display:       none;
    background:    var(--denied);
    color:         #fff;
    border-radius: 10px;
    padding:       1px 7px;
    font-size:     10px;
    font-weight:   700;
  }

  .badge--visible { display: inline-block; }

  .section-body--decisions {
    flex:       1;
    overflow-y: auto;
  }

  .section-body--decisions::-webkit-scrollbar       { width: 4px; }
  .section-body--decisions::-webkit-scrollbar-track { background: var(--bg); }
  .section-body--decisions::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

  /* ── Policy section body ── */

  .section-body--policy {
    flex-shrink: 0;
    padding:     12px;
    background:  var(--bg-deep);
    border-bottom: 1px solid var(--border);
  }

  .policy-label {
    display:       block;
    color:         var(--dim);
    font-size:     10px;
    margin-bottom: 5px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
  }

  .policy-select {
    width:         100%;
    background:    var(--bg);
    border:        1px solid var(--border);
    color:         var(--text);
    border-radius: 4px;
    padding:       5px 8px;
    font-family:   var(--font);
    font-size:     11px;
    margin-bottom: 8px;
    cursor:        pointer;
  }

  .policy-select:focus { outline: 1px solid var(--allowed); border-color: var(--allowed); }

  .policy-actions {
    display:     flex;
    align-items: center;
    gap:         10px;
  }

  .btn--apply {
    background:    var(--allowed);
    color:         #fff;
    border:        none;
    border-radius: 4px;
    cursor:        pointer;
    font-family:   var(--font);
    font-size:     11px;
    padding:       4px 14px;
    line-height:   1.5;
  }

  .btn--apply:hover    { background: #059669; }
  .btn--apply:disabled { opacity: 0.5; cursor: default; }
  .btn--applying       { opacity: 0.7; cursor: default; }

  .policy-status {
    font-size:   11px;
    flex:        1;
    white-space: nowrap;
    overflow:    hidden;
    text-overflow: ellipsis;
  }

  .policy-status--ok  { color: var(--allowed); }
  .policy-status--err { color: var(--denied); }

  .policy-loading,
  .policy-empty {
    color:       var(--dim);
    font-size:   11px;
    line-height: 1.5;
  }

  .policy-empty code {
    color:       var(--muted);
    font-family: var(--font);
  }

  /* ── Buttons ── */

  .btn {
    border:        none;
    border-radius: 4px;
    cursor:        pointer;
    font-family:   var(--font);
    font-size:     11px;
    padding:       3px 10px;
    line-height:   1.5;
  }

  .btn--primary  { background: var(--denied);  color: #fff; }
  .btn--ghost    { background: none; border: 1px solid var(--border); color: var(--muted); }
  .btn--ghost:hover { border-color: var(--muted); color: var(--text); }
  .btn--sm       { padding: 2px 7px; font-size: 10px; }

  /* ── Empty state ── */

  .empty {
    padding:    48px 20px;
    text-align: center;
    color:      var(--dim);
  }

  .empty-glyph { font-size: 28px; color: var(--allowed); margin-bottom: 10px; }
  .empty-hint  { font-size: 11px; margin-top: 6px; }

  /* ── Single decision ── */

  .decision {
    border-bottom: 1px solid var(--border);
    cursor:        pointer;
  }

  .decision:hover         { background: var(--bg-hover); }
  .decision--open         { background: #112236; }

  .decision-row {
    display:     flex;
    align-items: center;
    gap:         5px;
    padding:     8px 12px 2px;
    flex-wrap:   nowrap;
    overflow:    hidden;
  }

  .dot {
    width:       6px;
    height:      6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .verdict {
    font-weight:  700;
    font-size:    10px;
    letter-spacing: 0.5px;
    flex-shrink:  0;
    min-width:    36px;
  }

  .arrow {
    color:       var(--dim);
    font-size:   10px;
    flex-shrink: 0;
  }

  .outcome {
    font-weight:  700;
    font-size:    10px;
    letter-spacing: 0.5px;
    flex-shrink:  0;
  }

  .override-pill {
    border-radius: 3px;
    padding:       1px 5px;
    font-size:     9px;
    font-weight:   700;
    letter-spacing: 0.5px;
    flex-shrink:   0;
  }

  .override--permissive { background: rgba(245,158,11,0.2); color: var(--audit);      border: 1px solid rgba(245,158,11,0.3); }
  .override--suspended  { background: rgba(139,92,246,0.2); color: var(--suspended);  border: 1px solid rgba(139,92,246,0.3); }
  .override--lockdown   { background: rgba(220,38,38,0.2);  color: var(--lockdown);   border: 1px solid rgba(220,38,38,0.3);  }

  .action-name {
    color:       #f1f5f9;
    flex-shrink: 0;
  }

  .resource-name {
    color:         var(--dim);
    flex:          1;
    overflow:      hidden;
    text-overflow: ellipsis;
    white-space:   nowrap;
  }

  .ts {
    color:       var(--dim);
    font-size:   10px;
    flex-shrink: 0;
  }

  .decision-sub {
    display:   flex;
    gap:       8px;
    padding:   0 12px 8px 24px;
    font-size: 11px;
    color:     var(--dim);
  }

  .subject-id  { color: var(--muted); }
  .rule-id     { color: var(--dim); }
  .defaulted   { color: var(--audit); font-size: 10px; }

  /* ── Expanded detail ── */

  .detail {
    padding:     8px 12px 12px;
    border-top:  1px solid var(--border);
    background:  var(--bg-detail);
  }

  .detail-rows { margin-bottom: 10px; }

  .row {
    display:      flex;
    gap:          8px;
    margin-bottom: 5px;
    align-items:  flex-start;
  }

  .row-label {
    color:       var(--dim);
    width:       56px;
    flex-shrink: 0;
    padding-top: 1px;
  }

  .row-val {
    color:       #cbd5e1;
    white-space: pre-wrap;
    word-break:  break-word;
    font-size:   11px;
  }

  .flag-open-btn { margin-top: 4px; }

  /* ── Flag form ── */

  .flag-form {
    margin-top:    8px;
    background:    var(--bg-hover);
    border:        1px solid var(--border);
    border-radius: 6px;
    padding:       10px;
  }

  .flag-title {
    color:         #f1f5f9;
    font-weight:   600;
    margin-bottom: 8px;
  }

  .flag-radio {
    display:       flex;
    align-items:   flex-start;
    gap:           6px;
    color:         var(--text);
    margin-bottom: 8px;
    cursor:        pointer;
    line-height:   1.4;
  }

  .flag-radio input { margin-top: 2px; flex-shrink: 0; }

  .flag-note {
    width:         100%;
    background:    var(--bg);
    border:        1px solid var(--border);
    color:         var(--text);
    border-radius: 4px;
    padding:       6px 8px;
    font-family:   var(--font);
    font-size:     11px;
    resize:        vertical;
    margin-bottom: 8px;
    display:       block;
  }

  .flag-note:focus { outline: 1px solid var(--allowed); border-color: var(--allowed); }

  .flag-btns { display: flex; gap: 8px; }

  /* ── Status bar ── */

  .status {
    display:       flex;
    align-items:   center;
    gap:           8px;
    padding:       6px 12px;
    border-top:    1px solid var(--border);
    background:    var(--bg-deep);
    color:         var(--dim);
    font-size:     10px;
    flex-shrink:   0;
  }

  .status .dot {
    background: var(--dim);
    flex-shrink: 0;
  }

  .status .dot.dot--connected { background: var(--allowed); }
`

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour:   '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount)
} else {
  mount()
}
