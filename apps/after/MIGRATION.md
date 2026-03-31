# Migration: Before → After

This document shows the specific code changes made to fix each authorization anti-pattern
from the `before` demo. For context on why each pattern is a problem, see
[`../before/ANTI-PATTERNS.md`](../before/ANTI-PATTERNS.md).

The `after` app is structurally identical to `before` — same domain, same routes, same users —
so every change is a direct before/after comparison.

---

## AP-1 · One-Off Permission Booleans

**Files changed:** `src/data.ts`

**Before** — User interface with accumulated boolean flags:

```typescript
// before/src/data.ts
interface User {
  id:        string
  name:      string
  role:      'admin' | 'editor' | 'viewer' | 'guest'
  isAdmin:   boolean
  canEdit:   boolean
  isPremium: boolean
  isLegacy:  boolean
}
```

**After** — User interface with only identity and roles:

```typescript
// after/src/data.ts
interface User {
  id:    string
  name:  string
  roles: string[]   // authoritative source — no parallel boolean flags
  color: string
}
```

The policy (not the user object) decides what each combination of roles can do. Adding a new
permission question means adding a policy rule, not a new field on every User record.

---

## AP-2 · Authentication Treated as Authorisation

**Files changed:** `src/index.ts`

**Before** — A single `authenticate` middleware establishes identity; most routes treat that
as sufficient:

```typescript
// before/src/index.ts
function authenticate(req, res, next) {
  req.user = USERS[req.query.as] ?? USERS.stranger
  next()  // ← just sets identity, no capability check
}

app.get('/documents/:id', authenticate, (req, res) => {
  const doc = getDocById(req.params.id)
  // No resource-level check — logged in = allowed in
  res.send(docDetailPage(doc, req.user))
})
```

**After** — `authenticate` is gone. Every route specifies the action it requires. The enforcer
evaluates subject + resource + action against the policy:

```typescript
// after/src/index.ts
app.get('/documents/:id', authFor('read'), async (req, res) => {
  // Only reached if the policy granted 'read' for this user + document
  const doc  = getDoc(req)!
  const perms = await evalDocPerms(user, doc)
  res.send(docDetailPage(doc, user, perms))
})
```

`authFor('read')` expands to `createAuthMiddleware({ engine: enforcer, subject, resource, action: 'read', onDeny })`.

---

## AP-3 · Unprotected Endpoints

**Files changed:** `src/index.ts`

**Before** — `/users` has no authorization check, just a TODO comment:

```typescript
// before/src/index.ts
app.get('/users', authenticate, (req, res) => {
  // TODO: add auth check — only admins should see this
  res.send(usersPage(req.user!))
})
```

**After** — `systemAuthFor('manageUsers')` enforces access. Guests, viewers, and editors all
receive a 403:

```typescript
// after/src/index.ts
app.get('/users', systemAuthFor('manageUsers'), (req, res) => {
  res.send(usersPage(getUser(req)))
})
```

`manageUsers` is explicitly granted only by the `admin-system-access` policy rule.

---

## AP-4 · Frontend-Only Authorization

**Files changed:** `src/index.ts`, `src/views.ts`

**Before** — The delete button is hidden in the template, but the route has no server-side check:

```typescript
// before/src/views.ts
const canDelete = user.isAdmin   // hidden in template
const deleteBtn = canDelete ? actionForm(doc.id, 'delete', ...) : ''

// before/src/index.ts
app.post('/documents/:id/delete', authenticate, (req, res) => {
  // No authorization check — anyone can POST here directly
  res.send(docDetailPage(doc, req.user!, { type: 'success', ... }))
})
```

**After** — The server enforces `authFor('delete')` independently of what the UI shows:

```typescript
// after/src/index.ts
app.post('/documents/:id/delete', authFor('delete'), async (req, res) => {
  // Only reached if the policy granted 'delete'
  ...
})
```

The view still only renders the Delete button when `permissions.delete` is true — but this is now
consistent with the server because both read from the same policy evaluation.

Verification: `curl -X POST "http://localhost:3003/documents/doc-5/delete?as=stranger"` returns 403.

---

## AP-5 · Duplicated and Inconsistent Permission Logic

**Files changed:** `src/checks.ts` (deleted), `src/policy.ts` (new), `src/index.ts`

**Before** — Four different answers to "can this user modify this document?":

```typescript
// before/src/checks.ts
canEditDocument(user, doc)   // isAdmin || ownerId === user.id
canWriteDocument(user, doc)  // isAdmin || ownerId === user.id || role === 'editor'
canArchiveDocument(user, doc) // isAdmin || ownerId === user.id || canEdit (boolean flag)

// before/src/views.ts
const canEdit = user.isAdmin || isOwner || user.role === 'editor'  // fourth variant
```

The GET /edit handler used `canEditDocument` (no editors). The POST /edit handler used
`canWriteDocument` (editors allowed). An editor who isn't the owner saw an Edit button that
returned 403 on the GET but 200 on the POST.

**After** — One policy rule answers the question for all routes:

```typescript
// after/src/policy.ts
{
  id:    'editor-access',
  priority: 5,
  match: ({ subject }) => subject.roles.includes('editor'),
  allow: ['read', 'write', 'archive', 'viewHistory'],
},
```

Both `GET /documents/:id/edit` and `POST /documents/:id/edit` use `authFor('write')`. They
evaluate the same policy rule and cannot produce different results. `src/checks.ts` is deleted.

---

## AP-6 · Authorization Logic in the Data Layer

**Files changed:** `src/data.ts`, `src/index.ts`

**Before** — `getDocsForUser()` filters by role inside the data layer:

```typescript
// before/src/data.ts
export function getDocsForUser(user: User): Doc[] {
  if (user.isAdmin) return DOCS
  if (user.role === 'editor') {
    return DOCS.filter(d => d.ownerId === user.id || d.status === 'published')
  }
  return DOCS.filter(d => d.status === 'published' && !d.sensitive)
}
```

The route for `GET /documents/:id` did not call this function, so sensitivity filtering only
applied to the list view — not to direct document access.

**After** — The data layer returns raw data. The engine evaluates one decision per document:

```typescript
// after/src/data.ts
export function getAllDocs(): Doc[] {
  return DOCS   // no filtering — just data
}

// after/src/index.ts
app.get('/', async (req, res) => {
  const user = getUser(req)
  const all  = getAllDocs()
  const decisions = await engine.evaluateAll(user, all, 'read')
  const visible   = all.filter((_, i) => decisions[i]!.allowed)
  res.send(docListPage(user, visible))
})
```

`evaluateAll` fires one observer event per document — every read decision is visible in the
devtools sidebar.

---

## AP-7 · Authorization Logic in View Templates

**Files changed:** `src/views.ts`, `src/index.ts`

**Before** — Role checks inline in the template:

```typescript
// before/src/views.ts
const canEdit    = user.isAdmin || isOwner || user.role === 'editor'
const canArchive = (user.isAdmin || isOwner || user.canEdit) && doc.status !== 'archived'
const canDelete  = user.isAdmin
```

Three different expressions, using different user fields, producing different answers for the
same user/document pair.

**After** — Views receive a `DocPermissions` object. The template has zero role logic:

```typescript
// after/src/views.ts
export interface DocPermissions {
  write:       boolean
  archive:     boolean
  delete:      boolean
  viewHistory: boolean
}

export function docDetailPage(doc, user, permissions: DocPermissions, flash?) {
  const editBtn   = permissions.write   ? actionForm(...) : ''
  const archiveBtn = permissions.archive ? actionForm(...) : ''
  const deleteBtn  = permissions.delete  ? actionForm(...) : ''
  // No role checks. No user.isAdmin. No user.canEdit.
}
```

Permissions are evaluated in `index.ts` using `engine.can()`, so the view and the server always
agree:

```typescript
// after/src/index.ts
async function evalDocPerms(user, doc): Promise<DocPermissions> {
  const [write, archive, del, viewHistory] = await Promise.all([
    engine.can(user, doc, 'write'),
    engine.can(user, doc, 'archive'),
    engine.can(user, doc, 'delete'),
    engine.can(user, doc, 'viewHistory'),
  ])
  return { write, archive, delete: del, viewHistory }
}
```

---

## AP-8 · Allow-by-Default

**Files changed:** `src/policy.ts`, `src/checks.ts` (deleted)

**Before** — `canViewDocumentHistory` only checks the deny case:

```typescript
// before/src/checks.ts
export function canViewDocumentHistory(user: User, _doc: Doc): boolean {
  if (user.role === 'guest') return false
  return true   // everyone else allowed, including future roles
}
```

**After** — `defaultEffect: 'deny'` means `viewHistory` is denied unless a rule grants it:

```typescript
// after/src/policy.ts
export const documentPolicy = {
  defaultEffect: 'deny',   // ← explicit deny baseline
  rules: [
    { id: 'editor-access',  allow: ['read', 'write', 'archive', 'viewHistory'] },
    { id: 'owner-full-access', allow: ['read', 'write', 'archive', 'delete', 'viewHistory'] },
    { id: 'admin-full-access', allow: ['*'] },
    // Viewers: no viewHistory grant — denied by default
    // Future roles: denied by default until a rule is added
  ]
}
```

A `contractor` role added tomorrow gets no access until an explicit rule is written.

---

## AP-9 · Privilege Escalation via User Input

**Files changed:** `src/index.ts` (`authenticate` middleware removed, `POST /profile/role` removed)

**Before** — Two escalation vectors:

```typescript
// before/src/index.ts — ?promote=true upgrades any user to admin
if (req.query['promote'] === 'true' && !user.isAdmin) {
  req.user = { ...user, role: 'admin', isAdmin: true, canEdit: true }
}

// before/src/index.ts — users can set their own role to anything except admin
app.post('/profile/role', authenticate, (req, res) => {
  const newRole = req.body?.role
  if (newRole === 'admin' && !user.isAdmin) { return 403 }
  res.json({ ok: true, role: newRole })   // viewer → editor, no check
})
```

**After** — Neither mechanism exists. `getUser()` reads from the server-side `USERS` store only:

```typescript
// after/src/index.ts
function getUser(req: Request): User {
  const id = (req.query['as'] as string | undefined) ?? 'stranger'
  return USERS[id] ?? USERS['stranger']!   // server owns roles, not the client
}
```

There is no `?promote=true` param, no `POST /profile/role` endpoint, and no way for the client
to influence what roles `getUser()` returns.

---

## AP-10 · Hardcoded User IDs

**Files changed:** `src/checks.ts` (deleted), `src/data.ts`, `src/policy.ts`

**Before** — `canAccessAdmin()` special-cases a legacy account ID:

```typescript
// before/src/checks.ts
export function canAccessAdmin(user: User): boolean {
  return user.isAdmin || user.id === 'superadmin'   // hardcoded ID
}
```

**After** — The `superadmin` user is migrated to the normal role system. It has `roles: ['admin']`
like every other admin. The policy rule matches on the role, not the ID:

```typescript
// after/src/policy.ts
{
  id:    'admin-system-access',
  priority: 1,
  match: ({ subject }) => subject.roles.includes('admin'),
  allow: ['accessAdmin', 'manageUsers', 'viewReports'],
},
```

No user ID appears anywhere in the policy. Access can be revoked by removing the `admin` role
from the user record.

---

## AP-11 · Coarse-Grained Permissions

**Files changed:** `src/checks.ts` (deleted), `src/policy.ts`, `src/views.ts`, `src/index.ts`

**Before** — One boolean gates the entire admin area:

```typescript
// before/src/checks.ts
export function canAccessAdmin(user: User): boolean {
  return user.isAdmin || user.id === 'superadmin'
}

// before/src/index.ts
if (!canAccessAdmin(user)) { return 403 }
// All admin features now accessible
```

**After** — Three separate actions, each independently evaluated:

```typescript
// after/src/policy.ts
{ id: 'admin-system-access', allow: ['accessAdmin', 'manageUsers', 'viewReports'] }
// Can be split: give a user 'viewReports' only without 'manageUsers'

// after/src/index.ts
app.get('/admin', systemAuthFor('accessAdmin'), ...)  // enter the panel
app.get('/users', systemAuthFor('manageUsers'), ...)  // user management specifically

// after/src/views.ts — admin page renders sections based on granular permissions
const perms = await evalSystemPerms(user)
adminPage(user, perms)  // passes { accessAdmin, manageUsers, viewReports }
```

A future rule could grant `viewReports` to a user without `manageUsers` — impossible in the
before app.

---

## AP-12 · Business Flags Used as Authorization Checks

**Files changed:** `src/data.ts`, `src/policy.ts`, `src/index.ts`

**Before** — `isPremium` boolean on User, checked directly in the route:

```typescript
// before/src/data.ts
interface User { isPremium: boolean }

// before/src/index.ts
if (!user.isPremium) { return 403 }
```

Side-effects: admins without `isPremium = true` were blocked; billing state was scattered into
authorization code.

**After** — `premium` is a role. The policy has two rules that grant `viewReports`:

```typescript
// after/src/data.ts
// carol: roles: ['viewer', 'premium']  — viewer who pays
// admin: roles: ['admin']              — admin, no 'premium' needed

// after/src/policy.ts
{ id: 'premium-reports',      match: ({ subject }) => subject.roles.includes('premium'), allow: ['viewReports'] },
{ id: 'admin-system-access',  match: ({ subject }) => subject.roles.includes('admin'),   allow: ['viewReports'] },
```

Admin gets `viewReports` via `admin-system-access` — no `isPremium` flag required.
Dave (viewer, no premium) is denied. Carol (viewer, premium) is allowed.
Both outcomes come from the same policy evaluation, visible in the devtools sidebar.

---

## AP-13 · No Audit Trail

**Files changed:** `src/index.ts`

**Before** — No logging. Authorization decisions are made and immediately forgotten.

**After** — Every decision flows through `devtools.observer` before the route handler runs:

```typescript
// after/src/index.ts
const devtools = createDevTools({ port: DEVTOOLS_PORT, ... })

const engine = createAuthEngine({
  policy:    documentPolicy,
  observers: [devtools.observer],   // ← every decision is recorded
})
```

In development, decisions stream to the browser sidebar in real time: subject, resource, action,
outcome, policy rule, duration. In production, swap `devtools.observer` for (or add alongside):

- `@daltonr/authwrite-observer-pg` — writes to a Postgres audit log table
- `@daltonr/authwrite-observer-otel` — emits OpenTelemetry spans
- A custom observer that publishes to your event stream

The observer pattern means audit coverage is guaranteed at the engine level — individual route
handlers do not need to remember to log. Adding a new route automatically gets audit coverage.

---

## Summary of structural changes

| Concern                    | Before                                     | After                                              |
|----------------------------|--------------------------------------------|-----------------------------------------------------|
| Permission logic location  | data.ts + checks.ts + views.ts + routes    | policy.ts only                                      |
| User capability model      | isAdmin, canEdit, isPremium, isLegacy flags | roles array evaluated by policy                    |
| Route protection           | Ad-hoc, often missing                      | `authFor(action)` on every route                    |
| View button visibility     | Inline role checks in templates            | `DocPermissions` / `SystemPermissions` objects      |
| Default stance             | Allow (only specific denials)              | Deny (`defaultEffect: 'deny'`)                      |
| Admin access               | One boolean, hardcoded ID                  | Named actions: accessAdmin / manageUsers / viewReports |
| Decision visibility        | None                                       | DevTools observer on every evaluation               |
| Files deleted              | —                                          | `src/checks.ts` (all logic moved to policy.ts)      |
