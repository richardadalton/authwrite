import express, { type Request, type Response } from 'express'
import { createAuthEngine }                  from '@authwrite/core'

import { createExpressAuth }                  from '@authwrite/express'
import { createDevTools }                     from '@authwrite/devtools'
import { documentPolicy }                     from './policy.js'
import { USERS, getDocById, getAllDocs } from './data.js'
import type { User, Doc }                     from './data.js'
import {
  docListPage,
  docDetailPage,
  deniedPage,
  adminPage,
  usersPage,
  reportsPage,
  historyPage,
  type DocPermissions,
  type SystemPermissions,
} from './views.js'

const APP_PORT      = 3003
const DEVTOOLS_PORT = 4998

// ─── Auth engine ──────────────────────────────────────────────────────────────
//
// FIX AP-13 (no audit trail): Every authorization decision flows through
// devtools.observer. In development, decisions stream to the sidebar in real
// time. In production, the same observer pattern writes to a database,
// emits OpenTelemetry spans, or publishes to an audit log service.

const devtools = createDevTools({
  port:     DEVTOOLS_PORT,
  policies: {
    dir:     new URL('../policies', import.meta.url).pathname,
    onApply: async (filePath) => {
      console.log(`[policy switcher] Selected: ${filePath}`)
    },
  },
})

// Running in enforce mode: the policy decision is the final decision.
// Contrast with the 'demo' app which uses 'audit' mode.
const engine = createAuthEngine({
  policy:    documentPolicy,
  mode:      'enforce',
  observers: [devtools.observer],
})

// ─── Resolver helpers ─────────────────────────────────────────────────────────
//
// FIX AP-9 (privilege escalation): Identity comes from the server-side USERS
// store. The ?as= param is a demo convenience (simulating a session lookup).
// There is no ?promote=true param, no POST /profile/role endpoint. The server
// owns roles — the client cannot supply or modify them.

function getUser(req: Request): User {
  const id = (req.query['as'] as string | undefined) ?? 'stranger'
  return USERS[id] ?? USERS['stranger']!
}

function getDoc(req: Request): Doc | undefined {
  return getDocById(req.params['id']!)
}

// ─── Permission pre-evaluation ────────────────────────────────────────────────
//
// FIX AP-7 (auth in templates): Before rendering any document page, evaluate
// all relevant permissions using the engine. The view receives a plain boolean
// map — it renders what it's told, with no role logic of its own.

async function evalDocPerms(user: User, doc: Doc): Promise<DocPermissions> {
  const p = await engine.permissions(user, doc, ['write', 'archive', 'delete', 'viewHistory'])
  return { write: p['write']!, archive: p['archive']!, delete: p['delete']!, viewHistory: p['viewHistory']! }
}

async function evalSystemPerms(user: User): Promise<SystemPermissions> {
  const p = await engine.permissions(user, ['accessAdmin', 'manageUsers', 'viewReports'])
  return { accessAdmin: p['accessAdmin']!, manageUsers: p['manageUsers']!, viewReports: p['viewReports']! }
}

// ─── Auth middleware factories ────────────────────────────────────────────────
//
// FIX AP-2 (authn ≡ authz): Every route that modifies or displays a resource
// uses a specific named action. Authentication (who the user is) and
// authorization (what they may do) are separate steps.
//
// FIX AP-5 (duplicated logic): The enforcer calls the same policy for every
// route. There are no per-route check functions. GET /edit and POST /edit
// both go through auth('write') — they cannot disagree.
//
// createExpressAuth captures the engine, subject resolver, resource resolver,
// and onDeny handler once. The returned function produces per-route middleware
// with a single action argument.

const auth = createExpressAuth<User, Doc>({
  engine,
  subject:  getUser,
  resource: getDoc,
  onDeny: (req: Request, res: Response, decision) => {
    res.status(403).send(deniedPage(getUser(req), decision.context.action, decision.reason))
  },
})

const systemAuth = createExpressAuth<User, typeof SYSTEM_RESOURCE>({
  engine,
  subject:  getUser,
  resource: () => undefined,
  onDeny: (req: Request, res: Response, decision) => {
    res.status(403).send(deniedPage(getUser(req), decision.context.action, decision.reason))
  },
})

// ─── App ─────────────────────────────────────────────────────────────────────

const app = express()
app.use(express.urlencoded({ extended: false }))

// ── GET / — Document list ─────────────────────────────────────────────────────
//
// FIX AP-6 (auth in data layer): getAllDocs() returns every document with no
// filtering. We then ask the engine which ones this user can read, keeping the
// data layer and authorization layer separate.
//
// FIX AP-3 (unprotected): All routes have explicit auth evaluation. The list
// page uses evaluateAll() — one policy call per document — so the sidebar
// shows individual read decisions for every document.

app.get('/', async (req, res) => {
  const user = getUser(req)
  const all  = getAllDocs()

  // evaluateAll returns { resource, decision } per doc — each fires an observer event
  const results = await engine.evaluateAll(user, all, 'read')
  const visible = results.filter(r => r.decision.allowed).map(r => r.resource)

  res.send(docListPage(user, visible))
})

// ── GET /documents/:id ────────────────────────────────────────────────────────
//
// FIX AP-2 (authn ≡ authz): auth('read') enforces that this user may read
// this specific document. A guest cannot reach the body of a sensitive draft.
// FIX AP-7 (auth in templates): permissions are pre-evaluated and passed in.

app.get('/documents/:id', auth('read'), async (req, res) => {
  const user = getUser(req)
  const doc  = getDoc(req)!
  const perms = await evalDocPerms(user, doc)
  res.send(docDetailPage(doc, user, perms))
})

// ── GET /documents/:id/edit — Edit form ──────────────────────────────────────
//
// FIX AP-5 (GET/POST inconsistency): Both GET and POST use auth('write').
// The same policy rule applies to both — they cannot produce different results.

app.get('/documents/:id/edit', auth('write'), async (req, res) => {
  const user  = getUser(req)
  const doc   = getDoc(req)!
  const perms = await evalDocPerms(user, doc)
  res.send(docDetailPage(doc, user, perms, {
    type:    'info',
    message: '(Edit form would appear here.)',
  }))
})

// ── POST /documents/:id/edit ──────────────────────────────────────────────────

app.post('/documents/:id/edit', auth('write'), async (req, res) => {
  const user  = getUser(req)
  const doc   = getDoc(req)!
  const perms = await evalDocPerms(user, doc)
  res.send(docDetailPage(doc, user, perms, {
    type:    'success',
    message: '✓ Document updated successfully.',
  }))
})

// ── POST /documents/:id/archive ───────────────────────────────────────────────

app.post('/documents/:id/archive', auth('archive'), async (req, res) => {
  const user  = getUser(req)
  const doc   = getDoc(req)!
  const perms = await evalDocPerms(user, doc)
  res.send(docDetailPage(doc, user, perms, {
    type:    'success',
    message: '✓ Document archived.',
  }))
})

// ── POST /documents/:id/delete ────────────────────────────────────────────────
//
// FIX AP-4 (frontend-only auth): auth('delete') is enforced server-side.
// The server does not trust the UI to have hidden the button — it checks
// independently. A direct curl POST from a stranger returns 403.

app.post('/documents/:id/delete', auth('delete'), async (req, res) => {
  const user  = getUser(req)
  const doc   = getDoc(req)!
  const perms = await evalDocPerms(user, doc)
  res.send(docDetailPage(doc, user, perms, {
    type:    'success',
    message: '✓ Document deleted (demo — nothing was actually removed).',
  }))
})

// ── GET /documents/:id/history ────────────────────────────────────────────────
//
// FIX AP-8 (allow by default): 'viewHistory' must be explicitly allowed by a
// policy rule. It is only granted to editors, admins, and document owners.
// Guests, viewers, and future roles not yet defined are denied by default.

app.get('/documents/:id/history', auth('viewHistory'), (req, res) => {
  const user = getUser(req)
  const doc  = getDoc(req)!
  res.send(historyPage(doc, user))
})

// ── GET /admin ────────────────────────────────────────────────────────────────
//
// FIX AP-10 (hardcoded ID): No special case for 'superadmin'. Access comes
// from the 'admin' role via the admin-system-access policy rule.
// FIX AP-11 (coarse-grained): systemAuthFor checks 'accessAdmin' specifically.
// The admin page receives granular per-section permissions.

app.get('/admin', systemAuth('accessAdmin'), async (req, res) => {
  const user  = getUser(req)
  const perms = await evalSystemPerms(user)
  res.send(adminPage(user, perms))
})

// ── GET /users ────────────────────────────────────────────────────────────────
//
// FIX AP-3 (unprotected): 'manageUsers' is a specific, named permission.
// Viewers, editors, and guests cannot reach this endpoint.

app.get('/users', systemAuth('manageUsers'), (req, res) => {
  res.send(usersPage(getUser(req)))
})

// ── GET /reports ──────────────────────────────────────────────────────────────
//
// FIX AP-12 (business flag as auth): 'viewReports' is evaluated by the policy.
// Both the premium-reports rule (for paying users) and the admin-system-access
// rule (for admins) grant it — no special case, no boolean flag.
// Dave (viewer, no premium) is denied. Carol (viewer, premium) is allowed.
// Admin is allowed via admin-full-access — no isPremium field required.

app.get('/reports', systemAuth('viewReports'), (req, res) => {
  res.send(reportsPage(getUser(req)))
})

// ─── Start ────────────────────────────────────────────────────────────────────

await devtools.start()

app.listen(APP_PORT, () => {
  console.log(`\n  ◊  After (Authwrite) app:      http://localhost:${APP_PORT}`)
  console.log(`     DevTools sidebar:            http://localhost:${DEVTOOLS_PORT}`)
  console.log()
  console.log('  Anti-patterns fixed:')
  console.log('  ✓ AP-1  No boolean flags — roles array only')
  console.log('  ✓ AP-2  AuthN and AuthZ are separate steps')
  console.log('  ✓ AP-3  Every route has explicit authorization')
  console.log('  ✓ AP-4  DELETE has server-side auth (try curl as stranger)')
  console.log('  ✓ AP-5  One policy rule per concern, no duplication')
  console.log('  ✓ AP-6  Data layer returns raw data, auth layer filters')
  console.log('  ✓ AP-7  Views receive Permissions object, no role checks')
  console.log('  ✓ AP-8  defaultEffect: deny — explicit allows only')
  console.log('  ✓ AP-9  Roles are server-side — no ?promote=true')
  console.log('  ✓ AP-10 No hardcoded user IDs')
  console.log('  ✓ AP-11 Granular system actions: accessAdmin / manageUsers / viewReports')
  console.log('  ✓ AP-12 premium is a role, not a boolean flag')
  console.log('  ✓ AP-13 Every decision logged to devtools observer\n')
})
