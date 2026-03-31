import express, { type Request, type Response, type NextFunction } from 'express'
import { USERS, DOCS, getDocsForUser, getDocById } from './data.js'
import type { User, Doc } from './data.js'
import {
  canEditDocument,
  canWriteDocument,
  canArchiveDocument,
  canViewDocumentHistory,
  canAccessAdmin,
} from './checks.js'
import {
  layout,
  docListPage,
  docDetailPage,
  adminPage,
  usersPage,
  reportsPage,
  historyPage,
} from './views.js'

const APP_PORT = 3002

// ─── "Authentication" middleware ──────────────────────────────────────────────
//
// ANTI-PATTERN (privilege escalation via input): The user identity is read
// from the ?as= query param with zero verification. In "production" this would
// come from a session, but the session setup just copies whatever role the
// user had when they signed up — and there's an endpoint (POST /profile/role)
// that lets users update their own role.
//
// ANTI-PATTERN (authn ≡ authz): This middleware is called "auth" but it only
// establishes identity. Most routes then treat the presence of req.user as
// proof of authorization ("they're logged in, so they can do it").

declare global {
  namespace Express {
    interface Request {
      user?: User
    }
  }
}

function authenticate(req: Request, res: Response, next: NextFunction): void {
  const userId = (req.query['as'] as string | undefined) ?? 'stranger'
  const user   = USERS[userId]

  if (!user) {
    res.status(401).send(layout('Unauthorised', '<p>Unknown user.</p>', USERS['stranger']!))
    return
  }

  // ANTI-PATTERN (privilege escalation): A ?promote=true param silently
  // upgrades the user to admin for this request — simulating what happens when
  // role is read from an unvalidated request parameter or a JWT claim that
  // the client can forge.
  if (req.query['promote'] === 'true' && !user.isAdmin) {
    req.user = { ...user, role: 'admin', isAdmin: true, canEdit: true }
    console.warn(`[SECURITY] User ${user.id} self-promoted to admin via ?promote=true`)
  } else {
    req.user = user
  }

  next()
}

const app = express()
app.use(express.urlencoded({ extended: false }))

// ─── GET / — Document list ────────────────────────────────────────────────────
//
// ANTI-PATTERN (authn ≡ authz): authenticate() runs, so req.user is set,
// and that's treated as sufficient. The document list is filtered by
// getDocsForUser() which has its own auth logic baked in.

app.get('/', authenticate, (req, res) => {
  const user = req.user!
  // ANTI-PATTERN (auth in data layer): filtering happens inside getDocsForUser
  const docs = getDocsForUser(user)
  res.send(docListPage(user, docs))
})

// ─── GET /documents/:id — View document ──────────────────────────────────────
//
// ANTI-PATTERN (authn ≡ authz): Only checks that a user is logged in. Any
// authenticated user — including a guest with role 'guest' — can view any
// document, including sensitive drafts, by hitting this URL directly.
// The list page filters documents, but the detail page does not.

app.get('/documents/:id', authenticate, (req, res) => {
  const user = req.user!
  const doc  = getDocById(req.params['id']!)

  if (!doc) { res.status(404).send('Not found'); return }

  // ANTI-PATTERN: no resource-level check here. If you know the document ID,
  // you can read it regardless of status or sensitivity.
  res.send(docDetailPage(doc, user))
})

// ─── GET /documents/:id/edit — Edit form ─────────────────────────────────────
//
// ANTI-PATTERN (duplicated logic): Uses canEditDocument() from checks.ts, but
// the view template used a slightly different check (role === 'editor' || ...),
// so the Edit button is shown to editors in the UI but this route rejects them.

app.get('/documents/:id/edit', authenticate, (req, res) => {
  const user = req.user!
  const doc  = getDocById(req.params['id']!)

  if (!doc) { res.status(404).send('Not found'); return }

  // ANTI-PATTERN: canEditDocument only checks isAdmin + ownerId — not role.
  // Editors who aren't owners will see the Edit button (the view uses a
  // different check) but hit a 403 when they try to use it.
  if (!canEditDocument(user, doc)) {
    res.status(403).send(docDetailPage(doc, user, {
      type:    'error',
      message: `Access denied — you need to be an admin or the document owner.`,
    }))
    return
  }

  res.send(docDetailPage(doc, user, {
    type:    'info',
    message: '(Edit form would appear here in a real app.)',
  }))
})

// ─── POST /documents/:id/edit ─────────────────────────────────────────────────
//
// ANTI-PATTERN (duplicated, inconsistent logic): This POST handler uses
// canWriteDocument() which includes the editor role — different from the GET
// handler above which uses canEditDocument() (no editor role). The same action
// has two different authorization rules depending on which HTTP method you use.

app.post('/documents/:id/edit', authenticate, (req, res) => {
  const user = req.user!
  const doc  = getDocById(req.params['id']!)

  if (!doc) { res.status(404).send('Not found'); return }

  if (!canWriteDocument(user, doc)) {
    res.status(403).send(docDetailPage(doc, user, {
      type:    'error',
      message: `Access denied — ${user.name} cannot edit this document.`,
    }))
    return
  }

  res.send(docDetailPage(doc, user, {
    type:    'success',
    message: '✓ Document updated successfully.',
  }))
})

// ─── POST /documents/:id/archive ─────────────────────────────────────────────
//
// ANTI-PATTERN (duplicated logic): canArchiveDocument() is a third variant of
// the "can this user write to this document?" question. It uses the canEdit
// boolean flag rather than the role string, so Bob (editor, canEdit=false due
// to migration bug) cannot archive even though he should be able to.

app.post('/documents/:id/archive', authenticate, (req, res) => {
  const user = req.user!
  const doc  = getDocById(req.params['id']!)

  if (!doc) { res.status(404).send('Not found'); return }

  if (!canArchiveDocument(user, doc)) {
    res.status(403).send(docDetailPage(doc, user, {
      type:    'error',
      message: `Access denied — ${user.name} cannot archive this document.`,
    }))
    return
  }

  res.send(docDetailPage(doc, user, {
    type:    'success',
    message: '✓ Document archived.',
  }))
})

// ─── POST /documents/:id/delete ──────────────────────────────────────────────
//
// ANTI-PATTERN (frontend-only authorization): The view template hides the
// Delete button for non-admins. But this route handler has NO authorization
// check. Anyone who sends a POST request directly — e.g. with curl — can
// delete any document.
//
//   curl -X POST "http://localhost:3002/documents/doc-5/delete?as=stranger"
//
// The button just isn't shown; the server trusts that.

app.post('/documents/:id/delete', authenticate, (req, res) => {
  const doc = getDocById(req.params['id']!)
  if (!doc) { res.status(404).send('Not found'); return }

  // No authorization check — just trust the UI to have hidden the button.
  res.send(docDetailPage(doc, req.user!, {
    type:    'success',
    message: '✓ Document deleted (demo — nothing was actually removed).',
  }))
})

// ─── GET /documents/:id/history ──────────────────────────────────────────────
//
// ANTI-PATTERN (allow by default): canViewDocumentHistory() only explicitly
// blocks guests. All other users — including viewers and users who can't even
// see the document in the list — can access the full change history.

app.get('/documents/:id/history', authenticate, (req, res) => {
  const user = req.user!
  const doc  = getDocById(req.params['id']!)

  if (!doc) { res.status(404).send('Not found'); return }

  if (!canViewDocumentHistory(user, doc)) {
    res.status(403).send(docDetailPage(doc, user, {
      type:  'error',
      message: 'Access denied.',
    }))
    return
  }

  res.send(historyPage(doc, user))
})

// ─── GET /admin ───────────────────────────────────────────────────────────────
//
// ANTI-PATTERN (one-off boolean + hardcoded ID): Access is granted if
// user.isAdmin is true OR the user ID is literally 'superadmin'. This
// hardcoded special-case exists because the superadmin account was created
// before the role system and someone was afraid to migrate it.
//
// ANTI-PATTERN (coarse-grained): All admin functionality is behind one check.

app.get('/admin', authenticate, (req, res) => {
  const user = req.user!

  // ANTI-PATTERN: hardcoded ID + boolean flag. canAccessAdmin() encapsulates
  // this, but the logic is still wrong.
  if (!canAccessAdmin(user)) {
    res.status(403).send(layout('Access Denied', `
      <div style="padding:40px 0;text-align:center">
        <p style="font-size:16px;color:#64748b">
          You need <code>isAdmin = true</code> or <code>id = 'superadmin'</code>.
        </p>
        <p style="font-size:13px;color:#94a3b8;margin-top:8px">
          Try: <a href="/admin?as=superadmin">superadmin</a> or
          <a href="/admin?as=admin">admin</a>
        </p>
      </div>`, user))
    return
  }

  res.send(adminPage(user))
})

// ─── GET /users ───────────────────────────────────────────────────────────────
//
// ANTI-PATTERN (unprotected endpoint): No authorization check at all. This
// route exposes every user account — names, emails, roles, and all permission
// flags — to anyone who can reach the server, authenticated or not.
//
// This is common when an endpoint is "internal" initially and the auth check
// is noted as a TODO that never gets done.

app.get('/users', authenticate, (req, res) => {
  // TODO: add auth check — only admins should see this     ← classic
  res.send(usersPage(req.user!))
})

// ─── GET /reports ─────────────────────────────────────────────────────────────
//
// ANTI-PATTERN (business flag as auth): isPremium is a billing/subscription
// flag that has been repurposed as an authorization check. Business logic
// ("they pay for this") is mixed with authorization ("are they allowed").
// There is no admin override — even admins without isPremium=true are blocked.

app.get('/reports', authenticate, (req, res) => {
  const user = req.user!

  if (!user.isPremium) {
    res.status(403).send(layout('Reports — Upgrade Required', `
      <div style="padding:40px 0;text-align:center">
        <p style="font-size:16px;color:#64748b">
          Reports require a Premium account (<code>isPremium = true</code>).
        </p>
        <p style="font-size:13px;color:#94a3b8;margin-top:8px">
          Note: admins without isPremium are also blocked — there's no admin override.
          <br>Try as <a href="/reports?as=carol">carol</a> (viewer but premium)
          or <a href="/reports?as=alice">alice</a>.
        </p>
      </div>`, user))
    return
  }

  res.send(reportsPage(user))
})

// ─── POST /profile/role ───────────────────────────────────────────────────────
//
// ANTI-PATTERN (privilege escalation): Users can update their own role by
// posting to this endpoint. The check only prevents you from setting a role
// that's "higher" than viewer if you're not already an editor — but the check
// is based on the submitted value, not the server-stored role.

app.post('/profile/role', authenticate, (req, res) => {
  const user    = req.user!
  const newRole = req.body?.role as string | undefined

  if (!newRole) {
    res.status(400).json({ error: 'role is required' })
    return
  }

  // ANTI-PATTERN: "only admins can promote themselves to admin" — but this
  // check uses req.user which was already potentially forged via ?promote=true
  if (newRole === 'admin' && !user.isAdmin) {
    res.status(403).json({ error: 'Cannot self-promote to admin' })
    return
  }

  // For any other role, the update is accepted without question.
  // A viewer can make themselves an editor.
  console.log(`[PROFILE] User ${user.id} changed role from ${user.role} to ${newRole}`)
  res.json({ ok: true, role: newRole, warning: 'Role updated in memory only for this demo' })
})

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(APP_PORT, () => {
  console.log(`\n  ⚠  Before (anti-patterns) app: http://localhost:${APP_PORT}`)
  console.log()
  console.log('  Anti-patterns demonstrated:')
  console.log('  • One-off boolean flags (isAdmin, canEdit, isPremium, isLegacy)')
  console.log('  • Authentication treated as authorisation (authn ≡ authz)')
  console.log('  • Unprotected endpoint: GET /users')
  console.log('  • Frontend-only auth: POST /delete has no server check')
  console.log('  • Duplicated + inconsistent checks across routes')
  console.log('  • Auth logic in data layer (getDocsForUser)')
  console.log('  • Auth logic in view templates')
  console.log('  • Allow-by-default: GET /history blocks only guests')
  console.log('  • Privilege escalation: ?promote=true or POST /profile/role')
  console.log('  • Hardcoded user ID: superadmin special-case')
  console.log('  • Coarse-grained: all admin behind one boolean')
  console.log('  • Business flag as auth check: isPremium gates reports')
  console.log('  • No audit trail: decisions are invisible\n')
})
