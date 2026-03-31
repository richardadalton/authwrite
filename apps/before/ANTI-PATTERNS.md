# Authorization Anti-Patterns

This document catalogues the authorization problems present in the `before` demo app. The app
implements a document management system — the same domain as the `after` demo — but authorization
is handled the way it typically evolves in a real codebase: incrementally, inconsistently, and
without a coherent model.

Each pattern is named, explained, and traced to specific code locations. The `after` demo shows
how each is addressed with a proper authorization layer.

---

## AP-1 · One-Off Permission Booleans

**What it looks like**

The `User` object has accumulated boolean fields for every permission question that ever came up:

```typescript
interface User {
  role:      'admin' | 'editor' | 'viewer' | 'guest'  // the official role
  isAdmin:   boolean   // added when the admin panel was built
  canEdit:   boolean   // added when inline editing shipped ("just a flag for now")
  isPremium: boolean   // a billing flag that leaked into auth checks
  isLegacy:  boolean   // marks the pre-role-system legacy account
}
```

**Why it's a problem**

- Each boolean is a parallel, partial description of what a user can do. They overlap, contradict,
  and drift out of sync with each other and with the `role` field.
- Bob is `role: 'editor'` but `canEdit: false` due to a data migration bug. Different routes use
  different fields, so Bob can do some editor things and not others — with no visible reason why.
- Adding a new permission question means adding another boolean, which means another field on every
  user object, another place to update, and another source of inconsistency.

**Where it appears**

- `src/data.ts` — User interface definition
- `src/checks.ts` — `canArchiveDocument()` uses `user.canEdit` instead of `user.role`
- `src/views.ts` — `canArchive` check uses `user.canEdit` (inconsistent with `canArchiveDocument`)
- `src/index.ts` — `GET /reports` checks `user.isPremium`

---

## AP-2 · Authentication Treated as Authorisation

**What it looks like**

The `authenticate` middleware establishes identity. Most route handlers then treat the presence of
`req.user` as sufficient proof of authorisation:

```typescript
app.get('/documents/:id', authenticate, (req, res) => {
  const doc = getDocById(req.params['id']!)
  // No resource-level check — if you're logged in, you can read any document
  res.send(docDetailPage(doc, req.user!))
})
```

**Why it's a problem**

Authentication answers *who are you?*. Authorisation answers *what are you allowed to do?*. Stopping
at authentication means any authenticated user can perform any action the code doesn't explicitly
block — which is the wrong default. A guest account (`role: 'guest'`) can view the full content of
a sensitive draft document by navigating directly to its URL.

The root cause is the implicit assumption that "logged in" means "allowed in".

**Where it appears**

- `src/index.ts` — `GET /documents/:id` (no resource-level check)
- `src/index.ts` — `GET /users` (only runs authenticate, then shows all users)

---

## AP-3 · Unprotected Endpoints

**What it looks like**

Some routes run `authenticate` (establishing who the user is) but have no authorisation check:

```typescript
app.get('/users', authenticate, (req, res) => {
  // TODO: add auth check — only admins should see this
  res.send(usersPage(req.user!))
})
```

**Why it's a problem**

The TODO comment is a monument to intent without follow-through. The endpoint exposes every user
account — names, emails, roles, and all permission flags — to any authenticated user. Because
`authenticate` trusts the `?as=` query param, this means the data is effectively public to anyone
who can reach the server.

This pattern is common when an endpoint starts as "internal tooling" and the auth check is deferred
to a follow-up task that never ships.

**Where it appears**

- `src/index.ts` — `GET /users`
- `src/index.ts` — `GET /documents/:id` (auth check present but only checks authn, see AP-2)

---

## AP-4 · Frontend-Only Authorization

**What it looks like**

The Delete button is hidden in the view template for non-admins:

```typescript
// In views.ts — button only shown if user.isAdmin
const canDelete = user.isAdmin
const deleteBtn = canDelete ? actionForm(doc.id, 'delete', ...) : ''
```

But the server-side route that actually performs the deletion has no auth check:

```typescript
app.post('/documents/:id/delete', authenticate, (req, res) => {
  const doc = getDocById(req.params['id']!)
  // No authorization check — just trust the UI to have hidden the button
  res.send(docDetailPage(doc, req.user!, { type: 'success', message: '✓ Document deleted' }))
})
```

**Why it's a problem**

The UI is a convenience for legitimate users. It is not a security boundary. Anyone can send a POST
request directly:

```bash
curl -X POST "http://localhost:3002/documents/doc-5/delete?as=stranger"
```

This will succeed. A stranger with no roles can delete any document in the system.

Authorization must be enforced at the server, in the handler that performs the action. The UI can
mirror those checks to avoid showing buttons that will be rejected, but it cannot substitute for them.

**Where it appears**

- `src/views.ts` — `canDelete = user.isAdmin` (hidden in template)
- `src/index.ts` — `POST /documents/:id/delete` (no check)

---

## AP-5 · Duplicated and Inconsistent Permission Logic

**What it looks like**

The same fundamental question — "can this user modify this document?" — is answered four different
ways across the codebase:

```typescript
// checks.ts — canEditDocument(): admin or owner only
user.isAdmin || doc.ownerId === user.id

// checks.ts — canWriteDocument(): admin, owner, OR editor role
user.isAdmin || doc.ownerId === user.id || user.role === 'editor'

// checks.ts — canArchiveDocument(): admin, owner, OR canEdit flag
user.isAdmin || doc.ownerId === user.id || user.canEdit

// views.ts — template check for Edit button: admin, owner, OR editor role
user.isAdmin || isOwner || user.role === 'editor'
```

The `GET /documents/:id/edit` handler uses `canEditDocument` (no editors). The `POST` handler uses
`canWriteDocument` (editors allowed). An editor who isn't the document owner will see the Edit button
(view uses the same check as the POST), but clicking it to load the edit form returns a 403 (the GET
uses the stricter check). The POST succeeds if they somehow get there.

**Why it's a problem**

Duplication guarantees drift. Each copy evolves independently. Without a canonical definition of
"can modify", there is no way to answer "what does it take to edit a document?" — you have to read
every copy.

Changes must be applied everywhere, and there's no mechanism to verify they were. A security
review cannot find all the copies.

**Where it appears**

- `src/checks.ts` — three variants
- `src/views.ts` — fourth variant in templates
- `src/index.ts` — different handlers use different variants

---

## AP-6 · Authorization Logic in the Data Layer

**What it looks like**

Document retrieval is mixed with access filtering:

```typescript
// src/data.ts
export function getDocsForUser(user: User): Doc[] {
  if (user.isAdmin) return DOCS
  if (user.role === 'editor') {
    return DOCS.filter(d => d.ownerId === user.id || d.status === 'published')
  }
  return DOCS.filter(d => d.status === 'published' && !d.sensitive)
}
```

**Why it's a problem**

Authorization logic is now spread across the data layer, the route handlers, and the view templates.
The three copies will drift. The data layer's filtering is invisible from the route — a developer
reading the route sees `getDocsForUser(user)` and may not realise it already filtered results, or
may add a redundant check that conflicts with the filtering logic.

In a real application with a database, this pattern produces queries with permission conditions
baked into the SQL. Changing the permission model requires finding and updating every query.

**Where it appears**

- `src/data.ts` — `getDocsForUser()` filters by role and sensitivity
- Note: `src/index.ts` `GET /documents/:id` doesn't call this function, so the sensitivity
  filter only applies to the list view — not to direct document access

---

## AP-7 · Authorization Logic in View Templates

**What it looks like**

HTML templates contain role checks to decide what buttons to render:

```typescript
// src/views.ts
const canEdit   = user.isAdmin || isOwner || user.role === 'editor'
const canArchive = (user.isAdmin || isOwner || user.canEdit) && doc.status !== 'archived'
const canDelete  = user.isAdmin
```

**Why it's a problem**

Templates now contain a fifth set of authorization rules. A product change ("editors can now delete")
requires updating the template, the route handler, and possibly the check function — in three files —
and there's no automated way to verify consistency.

Template checks and server checks use different variables (`user.canEdit` vs `user.role`) so Bob's
Archive button is hidden (template uses `canEdit` flag = false) even though the server would accept
his archive request (route uses `canArchiveDocument` which checks `user.role`). Users learn the UI
can't be trusted.

**Where it appears**

- `src/views.ts` — `docListPage()`: `canEdit` check
- `src/views.ts` — `docDetailPage()`: `canEdit`, `canArchive`, `canDelete` checks

---

## AP-8 · Allow-by-Default

**What it looks like**

A permission function that only checks the deny case:

```typescript
// src/checks.ts
export function canViewDocumentHistory(user: User, _doc: Doc): boolean {
  if (user.role === 'guest') return false
  // "everyone else can see history, we'll add granularity later"
  return true
}
```

**Why it's a problem**

Any future role that isn't explicitly thought of inherits full access. If a `contractor` role is
added later, contractors can view document history unless someone remembers to update this function
— and there's no way to know this function exists without a full code search.

The correct default is deny. Permission should be explicitly granted, not granted by omission.

**Where it appears**

- `src/checks.ts` — `canViewDocumentHistory()`
- `src/index.ts` — `GET /documents/:id/history` uses this function

---

## AP-9 · Privilege Escalation via User Input

**What it looks like**

Two mechanisms that allow a user to elevate their own privileges:

**Via query parameter:**

```typescript
// src/index.ts — authenticate middleware
if (req.query['promote'] === 'true' && !user.isAdmin) {
  req.user = { ...user, role: 'admin', isAdmin: true, canEdit: true }
}
```

Any user can add `?promote=true` to any URL and receive admin-level access for that request.

**Via profile endpoint:**

```typescript
// src/index.ts — POST /profile/role
app.post('/profile/role', authenticate, (req, res) => {
  const newRole = req.body?.role
  if (newRole === 'admin' && !user.isAdmin) { /* blocked */ return }
  // Any other role is accepted without question
  res.json({ ok: true, role: newRole })
})
```

A viewer can promote themselves to editor with a single POST request.

**Why it's a problem**

Roles and permissions must be assigned by an authoritative source (an admin action, a provisioning
workflow) and stored server-side. They must never be derived from anything the user can supply or
modify. If roles come from a JWT, the JWT must be signed and the signature verified server-side.

**Where it appears**

- `src/index.ts` — `authenticate` middleware (`?promote=true`)
- `src/index.ts` — `POST /profile/role`

---

## AP-10 · Hardcoded User IDs

**What it looks like**

A special-case check for a specific user ID:

```typescript
// src/checks.ts
export function canAccessAdmin(user: User): boolean {
  return user.isAdmin || user.id === 'superadmin'
}
```

**Why it's a problem**

The `superadmin` account predates the role system. Instead of migrating it (assigning it the admin
role), the special case was added and then forgotten. It is now invisible to anyone looking at the
user table — the account looks like a normal admin, but it has a second path to access that survives
even if `isAdmin` is set to false.

Hardcoded IDs cannot be audited or revoked through normal access management. They are particularly
dangerous when they provide elevated access and are only known to the developer who added them.

**Where it appears**

- `src/checks.ts` — `canAccessAdmin()`
- `src/data.ts` — `superadmin` user with `isLegacy: true` flag

---

## AP-11 · Coarse-Grained Permissions

**What it looks like**

The entire admin area is protected by a single boolean:

```typescript
// src/checks.ts
export function canAccessAdmin(user: User): boolean {
  return user.isAdmin || user.id === 'superadmin'
}
```

This one check gates: user management, system configuration, reports, and audit logs.

**Why it's a problem**

There is no way to grant someone access to one admin function without granting all of them.
A support engineer who needs to look up user accounts gets system configuration access too.
A product manager who needs to see usage reports gets access to user management.

When the permission model is too coarse, people work around it: developers build separate "mini
admin" panels outside the access control system, or sensitive operations get moved to ad-hoc
scripts with no access control at all.

**Where it appears**

- `src/checks.ts` — `canAccessAdmin()`
- `src/views.ts` — `adminPage()` (all sections shown if check passes)
- `src/index.ts` — `GET /admin`

---

## AP-12 · Business Flags Used as Authorization Checks

**What it looks like**

A billing/subscription flag (`isPremium`) is used to gate a feature:

```typescript
// src/index.ts — GET /reports
if (!user.isPremium) {
  res.status(403).send(/* upgrade required page */)
  return
}
```

**Why it's a problem**

Billing state and access permissions are different concerns. `isPremium` answers "does this user pay
for the premium tier?" — it says nothing about whether their role entitles them to see reports.

The result is observable bugs: Carol (viewer, isPremium=true) can access reports. Bob (editor,
isPremium=false) cannot. An admin without `isPremium=true` is also blocked — there's no admin
override because the billing flag has no relationship to the admin role.

Business rules ("paying users get reports") should be expressed as policies ("users with the premium
entitlement may read reports") and evaluated alongside other authorization decisions — not as a
separate conditional scattered in the route handler.

**Where it appears**

- `src/data.ts` — `isPremium` on User interface
- `src/index.ts` — `GET /reports`

---

## AP-13 · No Audit Trail

**What it looks like**

Authorization decisions are made and immediately forgotten. There is no log of:
- Who was allowed to do what
- Who was denied and why
- What policy or rule applied
- When the decision was made

**Why it's a problem**

Without an audit trail:
- You cannot investigate a security incident ("how did this document get deleted?")
- You cannot demonstrate compliance ("prove that only authorized users accessed this data")
- You cannot test a policy change ("show me what would have been denied last week under the new rules")
- Developers cannot see the authorization model working — there is no feedback loop

The `after` demo addresses this directly: every authorization decision is recorded by the
`DevToolsObserver` and streamed to the sidebar in real time. In production, the same observer
pattern can write to a database, emit to an audit log service, or export as OpenTelemetry spans.

**Where it appears**

Everywhere — the absence is the pattern. No route in `src/index.ts` records its authorization
decision. The admin page explicitly notes: "Audit Log — No audit log exists."

---

## Summary

| ID    | Pattern                          | Root cause                                              |
|-------|----------------------------------|---------------------------------------------------------|
| AP-1  | One-off permission booleans      | No single source of truth for what a user can do        |
| AP-2  | AuthN treated as AuthZ           | No separation between identity and capability           |
| AP-3  | Unprotected endpoints            | Auth checks added reactively, not systematically        |
| AP-4  | Frontend-only authorization      | Confusion between "hiding" and "preventing"             |
| AP-5  | Duplicated + inconsistent checks | No canonical definition of each permission              |
| AP-6  | Auth in the data layer           | Permission logic has no designated home                 |
| AP-7  | Auth in view templates           | Same — templates become a fourth location               |
| AP-8  | Allow-by-default                 | Forgetting to define the deny baseline                  |
| AP-9  | Privilege escalation via input   | Trusting user-supplied values for security-sensitive data |
| AP-10 | Hardcoded user IDs               | One-off exceptions never cleaned up                     |
| AP-11 | Coarse-grained permissions       | No model for partial access; one flag for everything    |
| AP-12 | Business flags as auth checks    | Billing and access control conflated                    |
| AP-13 | No audit trail                   | Authorization treated as a gate, not a record           |

The common thread: authorization was never treated as a first-class concern with a defined model,
a single location, and systematic coverage. It was added reactively, feature by feature, by
different developers with different assumptions, and it accumulated debt with each change.
