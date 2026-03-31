# Chapter 13: Authorization Anti-Patterns

Authorization is one of software's most consistently misimplemented problems. The mistakes are well-understood and repeated across codebases in every language and framework. This chapter catalogs thirteen of them — drawn from real production code — with a brief explanation of why each is dangerous and how Authwrite addresses it.

---

## AP-1: Boolean flags instead of roles

**The pattern**

```typescript
interface User {
  id: string
  isAdmin: boolean
  isPremium: boolean
  isEditor: boolean
}

// In a route handler:
if (!user.isAdmin && !user.isEditor) {
  return res.status(403).send('Forbidden')
}
```

**Why it fails**

Boolean flags multiply. Every new feature requires a new flag, and the flag has to be added to every check that might interact with it. There is no central policy — authorization logic is scattered across dozens of `if (!user.isAdmin)` statements. When a new role needs to be introduced, or an existing role's permissions change, every scattered check must be found and updated.

**The fix**

Model permissions as roles in an array and enforce them through a central policy:

```typescript
interface User extends Subject {
  roles: string[]  // ['admin', 'editor', 'premium']
}

const policy: PolicyDefinition<User, Doc> = {
  id:            'documents',
  defaultEffect: 'deny',
  rules: [
    {
      id:    'admin-full-access',
      match: ({ subject }) => subject.roles.includes('admin'),
      allow: ['*'],
    },
    {
      id:    'editor-access',
      match: ({ subject }) => subject.roles.includes('editor'),
      allow: ['read', 'write', 'archive'],
    },
  ],
}
```

Every permission question goes through the engine. The policy is the single source of truth.

---

## AP-2: Treating authentication as authorization

**The pattern**

```typescript
// Auth middleware only checks if the user is logged in
app.use((req, res, next) => {
  if (!req.session.userId) return res.redirect('/login')
  next()
})

// Route handlers assume any logged-in user can do anything
app.get('/documents/:id', (req, res) => {
  const doc = db.getDoc(req.params.id)
  res.json(doc)  // No check that this user can read this specific document
})
```

**Why it fails**

Authentication answers "who is this?" Authorization answers "what may they do?" They are separate questions. A logged-in user who can authenticate successfully might still be unauthorized to read another user's private documents, perform admin actions, or delete records they don't own.

**The fix**

Every route that accesses a resource requires an explicit authorization check for the specific action on the specific resource:

```typescript
const auth = createExpressAuth<User, Doc>({
  engine,
  subject:  (req) => getUser(req),
  resource: (req) => getDocById(req.params.id),
  onDeny:   (req, res, decision) => res.status(403).json({ reason: decision.reason }),
})

// auth('read') checks that this user may read this specific document
app.get('/documents/:id', auth('read'), (req, res) => {
  res.json(getDocById(req.params.id))
})
```

Authentication lets the user through the front door. Authorization checks what they are allowed to do once inside.

---

## AP-3: Unprotected routes

**The pattern**

```typescript
// Some routes have auth middleware, some are forgotten
app.get('/documents/:id', authMiddleware, handler)
app.post('/documents/:id/edit', authMiddleware, handler)
app.post('/documents/:id/delete', handler)     // ← forgotten
app.get('/admin', handler)                      // ← forgotten
app.get('/reports', handler)                    // ← forgotten
```

**Why it fails**

Authorization added route-by-route is authorization that can be forgotten. A new engineer adds a route, does not know the convention for adding middleware, and ships an unprotected endpoint. This is not a hypothetical — it is a routine source of vulnerabilities.

**The fix**

Make protection the default rather than an opt-in. Apply a base auth check globally and require explicit declaration for each action:

```typescript
// Every route uses auth() or systemAuth() — there is no unprotected path
app.get('/documents/:id',         auth('read'),          handler)
app.get('/documents/:id/edit',    auth('write'),         handler)
app.post('/documents/:id/edit',   auth('write'),         handler)
app.post('/documents/:id/delete', auth('delete'),        handler)
app.get('/admin',                 systemAuth('accessAdmin'), handler)
app.get('/reports',               systemAuth('viewReports'), handler)
```

`auth` and `systemAuth` are produced by `createExpressAuth` with the engine, subject resolver, resource resolver, and default deny handler bound once. Each route explicitly names its required action.

---

## AP-4: Frontend-only authorization

**The pattern**

```typescript
// React component hides the delete button for non-admins
function DocumentActions({ user, doc }) {
  return (
    <div>
      {user.isAdmin && (
        <button onClick={() => deleteDoc(doc.id)}>Delete</button>
      )}
    </div>
  )
}

// But the server has no corresponding check
app.post('/documents/:id/delete', async (req, res) => {
  await db.delete(req.params.id)  // Anyone can call this directly
  res.json({ success: true })
})
```

**Why it fails**

UI rendering and server-side enforcement are two different things. Any user can call your API directly, bypass the UI entirely, and perform any action the server does not explicitly protect. Hiding a button is not authorization.

**The fix**

Server-side enforcement is mandatory. The UI may also hide buttons for UX reasons, but the server checks independently regardless:

```typescript
// Server enforces delete — a direct curl POST as a non-admin returns 403
app.post('/documents/:id/delete', auth('delete'), async (req, res) => {
  await db.delete(req.params.id)
  res.json({ success: true })
})

// UI can query permissions to decide what to show, but the server
// does not trust the UI to have hidden anything
const perms = await engine.permissions(user, doc, ['delete'])
// { delete: false }
```

---

## AP-5: Duplicated authorization logic

**The pattern**

```typescript
// GET /edit shows the form only if user can write
app.get('/documents/:id/edit', (req, res) => {
  const user = getUser(req)
  const doc  = getDoc(req)
  if (!user.roles.includes('editor') && doc.ownerId !== user.id) {
    return res.status(403).send('Forbidden')
  }
  res.send(editForm(doc))
})

// POST /edit saves changes — different check, written separately
app.post('/documents/:id/edit', (req, res) => {
  const user = getUser(req)
  const doc  = getDoc(req)
  if (user.roles.includes('admin') || doc.ownerId === user.id) {
    // Different condition — admins can now edit but couldn't see the form
    await save(doc, req.body)
  }
})
```

**Why it fails**

When the same authorization logic is written in multiple places, they will eventually disagree. In the example above, the GET check allows editors but the POST check allows admins — a discrepancy that could let a user save a document they cannot see the edit form for, or see the form but have their save rejected. Security bugs often live in these inconsistencies.

**The fix**

One policy rule per concern, applied through the same middleware for every route that requires the same permission:

```typescript
// The 'write' rule is defined once in the policy
// GET and POST both go through auth('write') — they cannot disagree
app.get('/documents/:id/edit',  auth('write'), showEditForm)
app.post('/documents/:id/edit', auth('write'), saveDocument)
```

The policy is the single source of truth. If the definition of "can write" changes, it changes in one place and applies to every route.

---

## AP-6: Authorization in the data layer

**The pattern**

```typescript
// Data layer filters what users can see as part of the query
async function getUserDocuments(userId: string) {
  return db.query(`
    SELECT * FROM documents
    WHERE owner_id = $1
      OR 'admin' = ANY(
        SELECT role FROM user_roles WHERE user_id = $1
      )
  `, [userId])
}
```

**Why it fails**

Embedding authorization in data queries couples the access control logic to the database schema. When roles change, queries must be found and updated. When a new access rule is introduced (e.g. shared documents), every relevant query must be updated. Testing is difficult because SQL queries are harder to unit-test than TypeScript. And the authorization logic is invisible to any audit trail.

**The fix**

The data layer returns raw data. Authorization is applied separately, after the data is fetched:

```typescript
// Data layer returns everything — no filtering
const all = await db.getAllDocuments()

// Authorization layer decides what the user may see
const results = await engine.evaluateAll(user, all, 'read')
const visible  = results.filter(r => r.decision.allowed).map(r => r.resource)
```

The data and authorization layers are independent. Each `evaluateAll` call fires an observer event per document, so the decision to show or hide each document is logged.

---

## AP-7: Authorization logic in templates

**The pattern**

```html
<!-- Handlebars / EJS / similar -->
{{#if user.isAdmin}}
  <button>Delete</button>
{{else if (eq doc.ownerId user.id)}}
  <button>Delete</button>
{{/if}}

{{#if (or user.isAdmin (includes user.roles 'editor'))}}
  <a href="/edit">Edit</a>
{{/if}}
```

**Why it fails**

Templates with authorization logic are impossible to test in isolation. The authorization logic is fragmented across every template that renders a page. When permissions change, every template must be found and updated. Logic that should live in one place ends up distributed across view files that are harder to review.

**The fix**

Pre-evaluate all permissions before rendering and pass a plain boolean map to the view. The view renders what it is told — it contains no role comparisons:

```typescript
// Evaluate all relevant permissions before rendering
const perms = await engine.permissions(user, doc, ['write', 'archive', 'delete', 'viewHistory'])
// { write: true, archive: true, delete: false, viewHistory: true }

// View receives a permissions object — no role checks needed
res.send(docDetailPage(doc, user, perms))
```

```typescript
// In the view function — no role logic
function docDetailPage(doc: Doc, user: User, perms: DocPermissions): string {
  return `
    ${perms.write    ? '<a href="/edit">Edit</a>'       : ''}
    ${perms.delete   ? '<button>Delete</button>'         : ''}
    ${perms.viewHistory ? '<a href="/history">History</a>' : ''}
  `
}
```

---

## AP-8: Allow by default

**The pattern**

```typescript
const policy: PolicyDefinition<User, Doc> = {
  id:            'documents',
  defaultEffect: 'allow',  // ← everything is allowed unless explicitly denied
  rules: [
    { id: 'block-guests', match: ctx => !ctx.subject.id, deny: ['*'] },
  ],
}
```

**Why it fails**

Allow-by-default means that any action not explicitly denied is permitted. When a new action is introduced — `'viewHistory'`, `'export'`, `'transfer-ownership'` — it is automatically allowed to everyone until a deny rule is added. This is the opposite of least-privilege. Security is opt-in rather than opt-out.

**The fix**

Use `defaultEffect: 'deny'`. Every action must be explicitly allowed by a rule. New actions, new roles, and unthought-of combinations are all denied until a rule explicitly grants them:

```typescript
const policy: PolicyDefinition<User, Doc> = {
  id:            'documents',
  defaultEffect: 'deny',  // ← deny unless explicitly allowed
  rules: [
    { id: 'owner-access',  match: ctx => ctx.resource?.ownerId === ctx.subject.id, allow: ['*'] },
    { id: 'editor-access', match: ctx => ctx.subject.roles.includes('editor'),      allow: ['read', 'write'] },
    // 'viewHistory' is not granted to editors — they cannot view history until a rule says so
  ],
}
```

---

## AP-9: Client-supplied roles

**The pattern**

```typescript
// User profile endpoint allows role self-assignment
app.post('/profile', (req, res) => {
  const { name, email, role } = req.body
  db.updateUser(req.session.userId, { name, email, role })
})

// Or: role elevated via query parameter in demo/dev code left in production
app.get('/documents/:id', (req, res) => {
  const role = req.query.role ?? req.session.user.role
  // ...
})
```

**Why it fails**

Allowing clients to supply or influence their own roles is a privilege escalation vulnerability. Any user can pass `?role=admin` or POST `{ role: 'admin' }` to gain elevated access. This class of vulnerability is consistently exploited.

**The fix**

Roles are set server-side and come from a trusted data store. The client has no input into what roles they have:

```typescript
// Identity comes from the server-side session/token lookup
function getUser(req: Request): User {
  const id = req.session.userId  // from signed session cookie or verified JWT
  return userStore.get(id)        // server owns the roles — client cannot supply them
}

// No ?promote=true, no POST /profile/role, no role from request body
```

---

## AP-10: Hardcoded user IDs

**The pattern**

```typescript
const SUPERADMIN_ID = 'usr_a1b2c3d4'

app.get('/admin', (req, res) => {
  if (req.session.userId !== SUPERADMIN_ID) {
    return res.status(403).send('Forbidden')
  }
  res.send(adminPage())
})
```

**Why it fails**

Hardcoded IDs create invisible, untested, privilege paths. If the user account is compromised, deactivated, or deleted, the hardcoded bypass remains. Auditors cannot find it without reading code. Tests will not cover it. When the user leaves the organisation the ID cannot be removed from sessions without a code deploy.

**The fix**

Access is derived from roles. Any user with the `'admin'` role has admin access. Roles are managed in the user store, not in application code:

```typescript
// In the policy — access comes from the role, not a specific ID
{
  id:    'admin-system-access',
  match: ({ subject }) => subject.roles.includes('admin'),
  allow: ['accessAdmin', 'manageUsers', 'viewReports'],
}

// Route — auth('accessAdmin') enforces the policy
app.get('/admin', systemAuth('accessAdmin'), adminHandler)
```

Adding or removing admin access requires changing a database record, not a code deploy. The change is auditable.

---

## AP-11: Coarse-grained permissions

**The pattern**

```typescript
// Everything behind the admin check is accessible to any admin
app.get('/admin', requireAdmin, (req, res) => res.send(adminPage()))
app.get('/admin/users', requireAdmin, (req, res) => res.send(usersPage()))
app.get('/admin/reports', requireAdmin, (req, res) => res.send(reportsPage()))
app.post('/admin/config', requireAdmin, (req, res) => saveConfig(req.body))
```

**Why it fails**

Coarse-grained permissions create all-or-nothing access. A user needs access to reports, so they are made an admin, and now have access to user management, configuration changes, and everything else. Least-privilege is impossible when there is only one privilege level.

**The fix**

Define specific named actions for each distinct access concern and grant them independently:

```typescript
// Separate actions for each admin capability
app.get('/admin',         systemAuth('accessAdmin'),  adminPageHandler)
app.get('/users',         systemAuth('manageUsers'),  usersHandler)
app.get('/reports',       systemAuth('viewReports'),  reportsHandler)
app.post('/admin/config', systemAuth('editConfig'),   configHandler)

// Policy grants each capability to specific roles
{
  id:    'admin-system-access',
  match: ({ subject }) => subject.roles.includes('admin'),
  allow: ['accessAdmin', 'manageUsers', 'viewReports', 'editConfig'],
},
{
  id:    'analyst-reports',
  match: ({ subject }) => subject.roles.includes('analyst'),
  allow: ['viewReports'],  // analysts can view reports without full admin access
},
```

A user can be granted `'viewReports'` without `'manageUsers'`. Roles are composable at the action level.

---

## AP-12: Business flags as authorization

**The pattern**

```typescript
// isPremium is a product/billing concept used as an authorization gate
app.get('/reports', async (req, res) => {
  const user = await getUser(req.session.userId)
  if (!user.isPremium && !user.isAdmin) {
    return res.status(402).send('Upgrade required')
  }
  res.send(reportsPage())
})
```

**Why it fails**

Product concepts (`isPremium`, `trialExpired`, `planTier`) have a different lifecycle from authorization concepts. Plans change, trials end, billing systems have outages. When a business flag is used as an authorization gate, the authorization logic becomes coupled to the billing system. Tests must mock billing state. Bugs in billing logic silently break access control.

**The fix**

Model entitlements as roles. The billing system sets roles; the policy enforces them. Authorization code never reads `isPremium`:

```typescript
// Billing system grants the 'premium' role when a subscription is active
// Authorization policy checks the role — no billing logic here
{
  id:    'premium-reports',
  match: ({ subject }) => subject.roles.includes('premium'),
  allow: ['viewReports'],
},
{
  id:    'admin-system-access',
  match: ({ subject }) => subject.roles.includes('admin'),
  allow: ['viewReports'],  // admins always have access — no isPremium check needed
},
```

The billing/subscription system writes to the user's `roles` array. Authorization reads from it. The two systems are decoupled.

---

## AP-13: No audit trail

**The pattern**

```typescript
// Authorization decisions are made inline with no record
app.get('/documents/:id', (req, res) => {
  const user = getUser(req)
  const doc  = getDoc(req.params.id)

  if (!canRead(user, doc)) {
    return res.status(403).send('Forbidden')  // No record of what was denied or why
  }

  res.json(doc)
})
```

**Why it fails**

Authorization without an audit trail is invisible. Security incidents cannot be investigated. Compliance requirements (SOC 2, GDPR, HIPAA) cannot be met. Unusual access patterns cannot be detected. When something goes wrong, you have no record of who accessed what, when, or why they were allowed.

**The fix**

Every authorization decision flows through an observer. The observer records the decision — whether it was allowed or denied, which rule fired, for which subject and resource, at what time. The observer is attached once; every route benefits automatically:

```typescript
const engine = createAuthEngine({
  policy,
  observers: [{
    onDecision({ decision }) {
      auditLog.write({
        allowed:    decision.allowed,
        reason:     decision.reason,
        policy:     decision.policy,
        subject:    decision.context.subject.id,
        action:     decision.context.action,
        resource:   decision.context.resource?.id,
        at:         decision.evaluatedAt,
        durationMs: decision.durationMs,
      })
    },
  }],
})
```

In development, the Authwrite DevTools sidebar shows every decision in real time. In production, the same observer pattern writes to your audit database, emits OpenTelemetry spans, or publishes to a SIEM. No authorization decision is silent.

---

## Summary

| Anti-pattern | Root cause | Fix |
|---|---|---|
| AP-1 Boolean flags | No central policy model | `roles: string[]` + `PolicyDefinition` |
| AP-2 AuthN ≡ AuthZ | Conflating "logged in" with "authorized" | Explicit action check per route |
| AP-3 Unprotected routes | Auth as opt-in per route | `createExpressAuth` bound factory |
| AP-4 Frontend-only auth | Trusting the UI | Server-side enforcement independent of UI |
| AP-5 Duplicated logic | Authorization scattered across handlers | One policy rule, one middleware per action |
| AP-6 Auth in data layer | Filtering in the database | Data layer returns all; auth layer filters |
| AP-7 Auth in templates | Role checks in view code | Pre-evaluate `permissions()`, pass boolean map |
| AP-8 Allow by default | `defaultEffect: 'allow'` | `defaultEffect: 'deny'` |
| AP-9 Client-supplied roles | Trusting user input for identity | Server-side role assignment from trusted store |
| AP-10 Hardcoded user IDs | Magic IDs in code | Role-based access, no ID special-cases |
| AP-11 Coarse-grained | One permission covers too much | Named actions per concern, composable roles |
| AP-12 Business flags as auth | Product state used as auth gate | Entitlements as roles, billing writes roles |
| AP-13 No audit trail | Inline checks with no observer | Engine observers record every decision |

---

© 2026 Devjoy Ltd. MIT License.
