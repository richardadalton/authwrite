import type { Doc, User } from './data.js'
import { DOCS, USERS, STATUS_LABEL } from './data.js'

const DEVTOOLS_PORT = 4999
const APP_PORT      = 3001

// ─── Layout ───────────────────────────────────────────────────────────────────

export function layout(title: string, body: string, currentUser: User): string {
  const userSwitcher = Object.values(USERS).map(u => {
    const active = u.id === currentUser.id
    return `<a href="/?as=${u.id}" class="user-chip${active ? ' user-chip--active' : ''}"
              style="${active ? `background:${u.color};color:#fff;border-color:${u.color}` : ''}">
              ${initials(u.name)}
              <span class="user-chip-name">${u.name}</span>
            </a>`
  }).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — Authwrite Demo</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f8fafc;
      color: #0f172a;
      /* Leave room for the devtools sidebar */
      padding-right: 360px;
    }

    a { color: inherit; text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* ── Header ── */

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

    .header-app {
      font-size: 14px;
      color: #64748b;
    }

    .header-spacer { flex: 1; }

    /* ── User switcher ── */

    .user-switcher {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
    }

    .user-switcher-label {
      color: #94a3b8;
      font-size: 11px;
      margin-right: 4px;
    }

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

    .user-chip:hover {
      border-color: #94a3b8;
      text-decoration: none;
    }

    .user-chip .avatar {
      width: 20px; height: 20px;
      border-radius: 50%;
      background: #e2e8f0;
      display: flex; align-items: center; justify-content: center;
      font-size: 9px; font-weight: 700; color: #fff;
    }

    .user-chip--active .avatar { background: rgba(255,255,255,0.3); }

    .user-chip-name { font-size: 11px; }

    /* ── Main content ── */

    .main {
      max-width: 860px;
      margin: 0 auto;
      padding: 32px 24px;
    }

    .page-title {
      font-size: 22px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 8px;
    }

    .page-subtitle {
      font-size: 14px;
      color: #64748b;
      margin-bottom: 28px;
    }

    /* ── Callout ── */

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

    .callout-icon { flex-shrink: 0; font-size: 16px; }

    /* ── Document list ── */

    .doc-list { display: flex; flex-direction: column; gap: 1px; }

    .doc-card {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 16px 20px;
      display: flex;
      align-items: flex-start;
      gap: 16px;
      margin-bottom: 8px;
    }

    .doc-card:hover { border-color: #94a3b8; }

    .doc-body { flex: 1; min-width: 0; }

    .doc-title {
      font-size: 15px;
      font-weight: 600;
      color: #0f172a;
      margin-bottom: 4px;
    }

    .doc-title a:hover { color: #10b981; }

    .doc-excerpt {
      font-size: 13px;
      color: #64748b;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-bottom: 8px;
    }

    .doc-meta {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 12px;
      color: #94a3b8;
    }

    .status-badge {
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
    }

    .status-published { background: #d1fae5; color: #065f46; }
    .status-draft     { background: #fef3c7; color: #92400e; }
    .status-archived  { background: #f1f5f9; color: #64748b; }

    .doc-actions { display: flex; gap: 6px; flex-shrink: 0; }

    /* ── Buttons ── */

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

    /* ── Document detail ── */

    .doc-detail {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      overflow: hidden;
    }

    .doc-detail-header {
      padding: 24px 28px 20px;
      border-bottom: 1px solid #e2e8f0;
    }

    .doc-detail-title {
      font-size: 24px;
      font-weight: 700;
      margin-bottom: 10px;
    }

    .doc-detail-meta {
      display: flex;
      gap: 16px;
      font-size: 13px;
      color: #64748b;
      align-items: center;
    }

    .doc-detail-body {
      padding: 24px 28px;
      font-size: 14px;
      color: #334155;
      line-height: 1.7;
    }

    .doc-detail-body p + p { margin-top: 14px; }

    .doc-actions-bar {
      padding: 16px 28px;
      border-top: 1px solid #e2e8f0;
      background: #f8fafc;
      display: flex;
      gap: 10px;
      align-items: center;
    }

    .actions-label {
      font-size: 12px;
      color: #94a3b8;
      margin-right: 6px;
    }

    /* ── Breadcrumb ── */

    .breadcrumb {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: #94a3b8;
      margin-bottom: 20px;
    }

    .breadcrumb a { color: #64748b; }
    .breadcrumb a:hover { color: #0f172a; }
    .breadcrumb-sep { color: #cbd5e1; }

    /* ── Flash message ── */

    .flash {
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 13px;
      margin-bottom: 20px;
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .flash-success { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
    .flash-info    { background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-logo">◊ Authwrite</div>
    <div class="header-app">Demo App</div>
    <div class="header-spacer"></div>
    <div class="user-switcher">
      <span class="user-switcher-label">Viewing as:</span>
      ${userSwitcher}
    </div>
  </div>

  <div class="main">
    ${body}
  </div>

  <!-- Authwrite DevTools sidebar (dev only) -->
  <script src="http://localhost:${DEVTOOLS_PORT}/devtools-client.js"></script>
</body>
</html>`
}

// ─── Document list page ───────────────────────────────────────────────────────

export function docListPage(currentUser: User): string {
  const cards = DOCS.map(doc => {
    const ownerLabel = doc.ownerId === currentUser.id ? 'your document' : `owner: ${doc.ownerId}`
    return `
      <div class="doc-card">
        <div class="doc-body">
          <div class="doc-title"><a href="/documents/${doc.id}?as=${currentUser.id}">${doc.title}</a></div>
          <div class="doc-excerpt">${doc.excerpt}</div>
          <div class="doc-meta">
            <span class="status-badge status-${doc.status}">${STATUS_LABEL[doc.status]}</span>
            <span>${ownerLabel}</span>
          </div>
        </div>
        <div class="doc-actions">
          <a class="btn btn-ghost btn-sm" href="/documents/${doc.id}?as=${currentUser.id}">View</a>
        </div>
      </div>`
  }).join('')

  const body = `
    <div class="callout">
      <span class="callout-icon">◊</span>
      <div>
        <strong>Authwrite DevTools demo</strong> — running in <strong>audit mode</strong>.
        The policy runs on every request, but all access is permitted so the app keeps working.
        Watch the sidebar to see what the policy <em>would</em> have decided.
        Switch users with the buttons in the header.
      </div>
    </div>

    <h1 class="page-title">Documents</h1>
    <p class="page-subtitle">Click any document to view it — every request triggers a policy evaluation visible in the sidebar.</p>

    <div class="doc-list">${cards}</div>`

  return layout('Documents', body, currentUser)
}

// ─── Document detail page ─────────────────────────────────────────────────────

export function docDetailPage(
  doc:         Doc,
  currentUser: User,
  flash?:      { type: 'success' | 'info'; message: string },
): string {
  const ownerLabel   = doc.ownerId === currentUser.id ? 'your document' : `owner: ${doc.ownerId}`
  const flashHtml    = flash
    ? `<div class="flash flash-${flash.type}">${flash.message}</div>`
    : ''

  // Action forms — each posts to a dedicated route so each gets its own auth decision
  const editForm    = actionForm(doc.id, 'edit',    currentUser.id, 'btn-secondary', 'Edit')
  const deleteForm  = actionForm(doc.id, 'delete',  currentUser.id, 'btn-danger',   'Delete')
  const archiveForm = doc.status !== 'archived'
    ? actionForm(doc.id, 'archive', currentUser.id, 'btn-ghost', 'Archive')
    : ''

  const body = `
    <div class="breadcrumb">
      <a href="/?as=${currentUser.id}">Documents</a>
      <span class="breadcrumb-sep">›</span>
      <span>${doc.title}</span>
    </div>

    ${flashHtml}

    <div class="doc-detail">
      <div class="doc-detail-header">
        <h1 class="doc-detail-title">${doc.title}</h1>
        <div class="doc-detail-meta">
          <span class="status-badge status-${doc.status}">${STATUS_LABEL[doc.status]}</span>
          <span>${ownerLabel}</span>
        </div>
      </div>

      <div class="doc-detail-body">
        <p>${doc.excerpt}</p>
        <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt
        ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco
        laboris nisi ut aliquip ex ea commodo consequat.</p>
        <p>Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat
        nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia
        deserunt mollit anim id est laborum.</p>
      </div>

      <div class="doc-actions-bar">
        <span class="actions-label">Actions:</span>
        ${editForm}
        ${archiveForm}
        ${deleteForm}
        <a class="btn btn-ghost btn-sm" href="/?as=${currentUser.id}">← Back</a>
      </div>
    </div>`

  return layout(doc.title, body, currentUser)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function actionForm(
  docId:   string,
  action:  string,
  userId:  string,
  btnClass: string,
  label:   string,
): string {
  return `
    <form method="POST" action="/documents/${docId}/${action}?as=${userId}" style="display:inline">
      <button type="submit" class="btn ${btnClass} btn-sm">${label}</button>
    </form>`
}

function initials(name: string): string {
  return name.split(' ')[0]!.slice(0, 2).toUpperCase()
}
