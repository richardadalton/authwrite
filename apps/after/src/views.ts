import type { User, Doc } from './data.js'
import { USERS, STATUS_LABEL } from './data.js'

const DEVTOOLS_PORT = 4998
const APP_PORT      = 3003

// ─── Permissions object ───────────────────────────────────────────────────────
//
// FIX AP-7 (auth in templates): Views receive a plain object of pre-evaluated
// boolean permissions. There are no role checks, no isAdmin comparisons, and
// no canEdit flag reads anywhere in this file. The view just renders what it
// is told.
//
// Permissions are evaluated by the engine in index.ts (one call per action per
// page render) and passed in. The view is a pure rendering function.

export interface DocPermissions {
  write:       boolean
  archive:     boolean
  delete:      boolean
  viewHistory: boolean
}

export interface SystemPermissions {
  accessAdmin:  boolean
  manageUsers:  boolean
  viewReports:  boolean
}

// ─── Layout ───────────────────────────────────────────────────────────────────

export function layout(title: string, body: string, currentUser: User): string {
  const userSwitcher = Object.values(USERS).map(u => {
    const active = u.id === currentUser.id
    return `<a href="/?as=${u.id}" class="user-chip${active ? ' user-chip--active' : ''}"
              style="${active ? `background:${u.color};color:#fff;border-color:${u.color}` : ''}">
              <span class="avatar" style="${active ? '' : `background:${u.color}`}">
                ${initials(u.name)}
              </span>
              <span class="user-chip-name">${u.name}</span>
            </a>`
  }).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — After (Authwrite)</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f8fafc;
      color: #0f172a;
      padding-right: 360px;
    }

    a { color: inherit; text-decoration: none; }
    a:hover { text-decoration: underline; }

    .header {
      background: #fff;
      border-bottom: 1px solid #e2e8f0;
      padding: 0 24px;
      height: 56px;
      display: flex;
      align-items: center;
      gap: 24px;
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .header-logo {
      color: #10b981;
      font-size: 20px;
      font-weight: 700;
      font-family: ui-monospace, monospace;
      letter-spacing: -0.5px;
    }

    .header-app { font-size: 14px; color: #64748b; }
    .header-spacer { flex: 1; }

    .nav-links { display: flex; gap: 4px; }

    .nav-link {
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 13px;
      color: #475569;
    }

    .nav-link:hover { background: #f1f5f9; text-decoration: none; }
    .nav-link--locked { color: #cbd5e1; cursor: not-allowed; }
    .nav-link--locked:hover { background: none; }

    .user-switcher {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
    }

    .user-switcher-label { color: #94a3b8; font-size: 11px; margin-right: 4px; }

    .user-chip {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px 4px 6px;
      border: 1px solid #e2e8f0;
      border-radius: 20px;
      cursor: pointer;
      color: #475569;
      font-size: 12px;
      white-space: nowrap;
    }

    .user-chip:hover { border-color: #94a3b8; text-decoration: none; }

    .user-chip .avatar {
      width: 20px; height: 20px;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 9px; font-weight: 700; color: #fff;
    }

    .user-chip--active .avatar { background: rgba(255,255,255,0.3) !important; }
    .user-chip-name { font-size: 11px; }

    .main { max-width: 900px; margin: 0 auto; padding: 32px 24px; }

    .page-title { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
    .page-subtitle { font-size: 14px; color: #64748b; margin-bottom: 28px; }

    .callout {
      background: #ecfdf5;
      border: 1px solid #6ee7b7;
      border-radius: 8px;
      padding: 12px 16px;
      font-size: 13px;
      color: #065f46;
      margin-bottom: 24px;
      display: flex;
      gap: 10px;
      align-items: flex-start;
    }

    .doc-list { display: flex; flex-direction: column; gap: 8px; }

    .doc-card {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 16px 20px;
      display: flex;
      align-items: flex-start;
      gap: 16px;
    }

    .doc-card:hover { border-color: #94a3b8; }
    .doc-body { flex: 1; min-width: 0; }
    .doc-title { font-size: 15px; font-weight: 600; margin-bottom: 4px; }
    .doc-title a:hover { color: #10b981; }

    .doc-excerpt {
      font-size: 13px;
      color: #64748b;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-bottom: 8px;
    }

    .doc-meta { display: flex; align-items: center; gap: 12px; font-size: 12px; color: #94a3b8; }

    .status-badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .status-published { background: #d1fae5; color: #065f46; }
    .status-draft     { background: #fef3c7; color: #92400e; }
    .status-archived  { background: #f1f5f9; color: #64748b; }
    .sensitive-badge  { background: #fee2e2; color: #991b1b; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }

    .doc-actions { display: flex; gap: 6px; flex-shrink: 0; }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 14px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid transparent;
      text-decoration: none;
    }

    .btn:hover { text-decoration: none; }
    .btn-primary   { background: #10b981; color: #fff; }
    .btn-primary:hover { background: #059669; }
    .btn-secondary { background: #fff; color: #374151; border-color: #d1d5db; }
    .btn-secondary:hover { background: #f9fafb; }
    .btn-danger    { background: #fff; color: #dc2626; border-color: #fca5a5; }
    .btn-danger:hover { background: #fef2f2; }
    .btn-ghost     { background: none; color: #64748b; border-color: #e2e8f0; }
    .btn-ghost:hover { background: #f8fafc; }
    .btn-sm { padding: 4px 10px; font-size: 12px; }

    .doc-detail {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      overflow: hidden;
    }

    .doc-detail-header { padding: 24px 28px 20px; border-bottom: 1px solid #e2e8f0; }
    .doc-detail-title  { font-size: 24px; font-weight: 700; margin-bottom: 10px; }
    .doc-detail-meta   { display: flex; gap: 16px; font-size: 13px; color: #64748b; align-items: center; }
    .doc-detail-body   { padding: 24px 28px; font-size: 14px; color: #334155; line-height: 1.7; }
    .doc-detail-body p + p { margin-top: 14px; }

    .doc-actions-bar {
      padding: 16px 28px;
      border-top: 1px solid #e2e8f0;
      background: #f8fafc;
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }

    .actions-label { font-size: 12px; color: #94a3b8; margin-right: 6px; }

    .breadcrumb { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #94a3b8; margin-bottom: 20px; }
    .breadcrumb a { color: #64748b; }
    .breadcrumb a:hover { color: #0f172a; }
    .breadcrumb-sep { color: #cbd5e1; }

    .flash { padding: 12px 16px; border-radius: 8px; font-size: 13px; margin-bottom: 20px; display: flex; gap: 8px; align-items: flex-start; }
    .flash-success { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
    .flash-info    { background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; }
    .flash-error   { background: #fef2f2; color: #991b1b; border: 1px solid #fca5a5; }

    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0; }
    th { background: #f8fafc; padding: 10px 16px; text-align: left; font-size: 12px; color: #64748b; font-weight: 600; border-bottom: 1px solid #e2e8f0; }
    td { padding: 12px 16px; font-size: 13px; border-bottom: 1px solid #f1f5f9; }
    tr:last-child td { border-bottom: none; }

    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .badge-purple { background: #ede9fe; color: #5b21b6; }
    .badge-blue   { background: #dbeafe; color: #1e40af; }
    .badge-green  { background: #d1fae5; color: #065f46; }
    .badge-gray   { background: #f1f5f9; color: #64748b; }

    .denied-page {
      padding: 60px 0;
      text-align: center;
    }

    .denied-page h1 { font-size: 20px; margin-bottom: 8px; color: #0f172a; }
    .denied-page p  { font-size: 14px; color: #64748b; margin-bottom: 4px; }
    .denied-page .reason { font-family: ui-monospace, monospace; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-logo">◊ After</div>
    <div class="header-app">Authwrite Demo</div>
    <nav class="nav-links">
      <a class="nav-link" href="/?as=${currentUser.id}">Documents</a>
      <a class="nav-link" href="/admin?as=${currentUser.id}">Admin</a>
      <a class="nav-link" href="/users?as=${currentUser.id}">Users</a>
      <a class="nav-link" href="/reports?as=${currentUser.id}">Reports</a>
    </nav>
    <div class="header-spacer"></div>
    <div class="user-switcher">
      <span class="user-switcher-label">Viewing as:</span>
      ${userSwitcher}
    </div>
  </div>

  <div class="main">
    ${body}
  </div>

  <script src="http://localhost:${DEVTOOLS_PORT}/devtools-client.js"></script>
</body>
</html>`
}

// ─── Document list page ───────────────────────────────────────────────────────
//
// FIX AP-7 (auth in templates): The list receives only the docs the caller
// decided to include — it renders all of them. No role checks here.
// FIX AP-6 (auth in data layer): Caller passes in the pre-filtered list
// from the auth layer (only docs the user can read), not from the data layer.

export function docListPage(user: User, docs: Doc[]): string {
  const cards = docs.map(doc => `
    <div class="doc-card">
      <div class="doc-body">
        <div class="doc-title"><a href="/documents/${doc.id}?as=${user.id}">${doc.title}</a></div>
        <div class="doc-excerpt">${doc.excerpt}</div>
        <div class="doc-meta">
          <span class="status-badge status-${doc.status}">${STATUS_LABEL[doc.status]}</span>
          ${doc.sensitive ? '<span class="sensitive-badge">Sensitive</span>' : ''}
          <span>${doc.ownerId === user.id ? 'your document' : `owner: ${doc.ownerId}`}</span>
        </div>
      </div>
      <div class="doc-actions">
        <a class="btn btn-ghost btn-sm" href="/documents/${doc.id}?as=${user.id}">View</a>
      </div>
    </div>`).join('')

  const body = `
    <div class="callout">
      ◊ <div>
        <strong>Authwrite</strong> — every action is evaluated by the policy.
        Decisions stream to the sidebar in real time.
        Switch users to see how access changes.
        Compare with the <a href="http://localhost:3002/?as=${user.id}" style="color:#065f46">before demo</a>.
      </div>
    </div>

    <h1 class="page-title">Documents</h1>
    <p class="page-subtitle">
      Viewing as <strong>${user.name}</strong>
      (roles: <code>${user.roles.join(', ') || 'none'}</code>)
      — showing ${docs.length} accessible document${docs.length !== 1 ? 's' : ''}.
    </p>

    <div class="doc-list">${cards}</div>`

  return layout('Documents', body, user)
}

// ─── Document detail page ─────────────────────────────────────────────────────
//
// FIX AP-7 (auth in templates): Button visibility is driven entirely by the
// DocPermissions object passed in. The template contains zero role checks.
// The permissions were evaluated by the engine in index.ts and passed in.

export function docDetailPage(
  doc:         Doc,
  user:        User,
  permissions: DocPermissions,
  flash?:      { type: 'success' | 'info' | 'error'; message: string },
): string {
  const flashHtml = flash
    ? `<div class="flash flash-${flash.type}">${flash.message}</div>`
    : ''

  // No role checks here — render exactly what permissions say
  const editBtn    = permissions.write
    ? actionForm(doc.id, 'edit',    user.id, 'btn-secondary', 'Edit')
    : ''
  const archiveBtn = permissions.archive
    ? actionForm(doc.id, 'archive', user.id, 'btn-ghost',     'Archive')
    : ''
  const deleteBtn  = permissions.delete
    ? actionForm(doc.id, 'delete',  user.id, 'btn-danger',    'Delete')
    : ''
  const historyBtn = permissions.viewHistory
    ? `<a class="btn btn-ghost btn-sm" href="/documents/${doc.id}/history?as=${user.id}">History</a>`
    : ''

  const body = `
    <div class="breadcrumb">
      <a href="/?as=${user.id}">Documents</a>
      <span class="breadcrumb-sep">›</span>
      <span>${doc.title}</span>
    </div>

    ${flashHtml}

    <div class="doc-detail">
      <div class="doc-detail-header">
        <h1 class="doc-detail-title">${doc.title}</h1>
        <div class="doc-detail-meta">
          <span class="status-badge status-${doc.status}">${STATUS_LABEL[doc.status]}</span>
          ${doc.sensitive ? '<span class="sensitive-badge">Sensitive</span>' : ''}
          <span>${doc.ownerId === user.id ? 'your document' : `owner: ${doc.ownerId}`}</span>
        </div>
      </div>

      <div class="doc-detail-body">
        <p>${doc.excerpt}</p>
        <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt
        ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation
        ullamco laboris nisi ut aliquip ex ea commodo consequat.</p>
        <p>Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat
        nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia
        deserunt mollit anim id est laborum.</p>
      </div>

      <div class="doc-actions-bar">
        <span class="actions-label">Actions:</span>
        ${editBtn}
        ${archiveBtn}
        ${deleteBtn}
        ${historyBtn}
        <a class="btn btn-ghost btn-sm" href="/?as=${user.id}">← Back</a>
      </div>
    </div>`

  return layout(doc.title, body, user)
}

// ─── Denied page ──────────────────────────────────────────────────────────────

export function deniedPage(
  user:   User,
  action: string,
  reason: string,
): string {
  const body = `
    <div class="denied-page">
      <h1>Access Denied</h1>
      <p>You do not have permission to <strong>${action}</strong>.</p>
      <p class="reason">policy reason: ${reason}</p>
      <p style="margin-top:20px">
        <a class="btn btn-ghost btn-sm" href="/?as=${user.id}">← Back to documents</a>
      </p>
    </div>`

  return layout('Access Denied', body, user)
}

// ─── Admin page ───────────────────────────────────────────────────────────────
//
// FIX AP-11 (coarse-grained): Receives a SystemPermissions object. Each admin
// sub-section can be individually shown or hidden based on the specific
// permission — not a single isAdmin boolean.

export function adminPage(user: User, perms: SystemPermissions): string {
  const body = `
    <h1 class="page-title">Admin Panel</h1>
    <p class="page-subtitle">
      Access granted via <code>admin-system-access</code> policy rule.
    </p>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:20px">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:8px">User Management</h3>
        <p style="font-size:13px;color:#64748b;margin-bottom:12px">View and manage user accounts.</p>
        ${perms.manageUsers
          ? `<a href="/users?as=${user.id}" class="btn btn-secondary btn-sm">Manage Users</a>`
          : `<span style="font-size:12px;color:#94a3b8">Not permitted (manageUsers)</span>`}
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:20px">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:8px">Reports</h3>
        <p style="font-size:13px;color:#64748b;margin-bottom:12px">Access analytics and usage reports.</p>
        ${perms.viewReports
          ? `<a href="/reports?as=${user.id}" class="btn btn-secondary btn-sm">View Reports</a>`
          : `<span style="font-size:12px;color:#94a3b8">Not permitted (viewReports)</span>`}
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:20px">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:8px">Audit Log</h3>
        <p style="font-size:13px;color:#64748b;margin-bottom:12px">Every authorization decision, streamed live.</p>
        <span style="font-size:12px;color:#10b981">✓ See the devtools sidebar →</span>
      </div>
    </div>`

  return layout('Admin', body, user)
}

// ─── Users page ───────────────────────────────────────────────────────────────

export function usersPage(user: User): string {
  const rows = Object.values(USERS).map(u => `
    <tr>
      <td>${u.name}</td>
      <td><code style="font-size:11px">${u.id}@example.com</code></td>
      <td>${u.roles.map(r =>
        `<span class="badge badge-${r === 'admin' ? 'purple' : r === 'editor' ? 'blue' : r === 'premium' ? 'green' : 'gray'}">${r}</span>`
      ).join(' ') || '<span class="badge badge-gray">none</span>'}</td>
    </tr>`).join('')

  const body = `
    <h1 class="page-title">All Users</h1>
    <p class="page-subtitle">Accessible because you have the <code>manageUsers</code> permission.</p>

    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Roles</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <p style="font-size:12px;color:#94a3b8;margin-top:12px">
      No boolean flags. Access is determined entirely by roles evaluated against the policy.
    </p>`

  return layout('Users', body, user)
}

// ─── Reports page ─────────────────────────────────────────────────────────────

export function reportsPage(user: User): string {
  const body = `
    <h1 class="page-title">Reports</h1>
    <p class="page-subtitle">
      Accessible via the <code>premium-reports</code> or <code>admin-system-access</code>
      policy rule — not a boolean flag.
    </p>

    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:20px">
        <div style="font-size:28px;font-weight:700">247</div>
        <div style="font-size:13px;color:#64748b;margin-top:4px">Documents total</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:20px">
        <div style="font-size:28px;font-weight:700">1,432</div>
        <div style="font-size:13px;color:#64748b;margin-top:4px">Page views this week</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:20px">
        <div style="font-size:28px;font-weight:700">18</div>
        <div style="font-size:13px;color:#64748b;margin-top:4px">Active users</div>
      </div>
    </div>`

  return layout('Reports', body, user)
}

// ─── History page ─────────────────────────────────────────────────────────────

export function historyPage(doc: Doc, user: User): string {
  const entries = [
    { date: '2026-03-28', actor: 'alice', action: 'published' },
    { date: '2026-03-25', actor: 'alice', action: 'edited'    },
    { date: '2026-03-20', actor: 'bob',   action: 'edited'    },
    { date: '2026-03-15', actor: 'alice', action: 'created'   },
  ]

  const rows = entries.map(e => `
    <tr><td>${e.date}</td><td>${e.actor}</td><td>${e.action}</td></tr>`).join('')

  const body = `
    <div class="breadcrumb">
      <a href="/?as=${user.id}">Documents</a>
      <span class="breadcrumb-sep">›</span>
      <a href="/documents/${doc.id}?as=${user.id}">${doc.title}</a>
      <span class="breadcrumb-sep">›</span>
      <span>History</span>
    </div>

    <h1 class="page-title">Document History</h1>
    <p class="page-subtitle">
      Access granted via <code>viewHistory</code> permission — explicit allow, not allow-by-default.
    </p>

    <table>
      <thead><tr><th>Date</th><th>Actor</th><th>Action</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`

  return layout(`History — ${doc.title}`, body, user)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function actionForm(
  docId:    string,
  action:   string,
  userId:   string,
  btnClass: string,
  label:    string,
): string {
  return `
    <form method="POST" action="/documents/${docId}/${action}?as=${userId}" style="display:inline">
      <button type="submit" class="btn ${btnClass} btn-sm">${label}</button>
    </form>`
}

function initials(name: string): string {
  return name.split(' ')[0]!.slice(0, 2).toUpperCase()
}
