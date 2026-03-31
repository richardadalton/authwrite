import express, { type Request, type Response } from 'express'
import { createAuthEngine, createEnforcer } from '@authwrite/core'
import type { Decision } from '@authwrite/core'
import { createAuthMiddleware } from '@authwrite/express'
import { createDevTools } from '@authwrite/devtools'
import { documentPolicy } from './policy.js'
import { DOCS, USERS, type Doc, type User } from './data.js'
import { docListPage, docDetailPage } from './views.js'

const APP_PORT      = 3001
const DEVTOOLS_PORT = 4999

// ─── Auth engine ──────────────────────────────────────────────────────────────

const devtools = createDevTools({ port: DEVTOOLS_PORT })

const engine   = createAuthEngine({
  policy:    documentPolicy,
  observers: [devtools.observer],
})

// Running in audit mode: the policy evaluates honestly, the enforcer lets
// everything through. The sidebar shows the real decisions.
const enforcer = createEnforcer(engine, { mode: 'audit' })

// ─── Resolver helpers ─────────────────────────────────────────────────────────

function getUser(req: Request): User {
  const id = (req.query['as'] as string | undefined) ?? 'carol'
  return USERS[id] ?? USERS['carol']!
}

function getDoc(req: Request): Doc | undefined {
  return DOCS.find(d => d.id === req.params['id'])
}

// ─── Per-action middleware factories ─────────────────────────────────────────

function authFor(action: string) {
  return createAuthMiddleware<User, Doc>({
    engine:   enforcer,
    subject:  (req: Request) => getUser(req),
    resource: (req: Request) => getDoc(req),
    action,
    // In audit mode onDeny is never called, but we wire it up so the demo
    // works correctly if you switch to enforce mode.
    onDeny: (req: Request, res: Response, decision: Decision) => {
      const doc = getDoc(req)
      if (!doc) { res.status(404).send('Not found'); return }
      const user = getUser(req)
      res.status(403).send(
        docDetailPage(doc, user, {
          type:    'info',
          message: `Access denied: ${decision.reason} (action: ${action})`,
        }),
      )
    },
  })
}

// ─── App ─────────────────────────────────────────────────────────────────────

const app = express()
app.use(express.urlencoded({ extended: false }))

// ── GET / ─────────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.send(docListPage(getUser(req)))
})

// ── GET /documents/:id ────────────────────────────────────────────────────────

app.get('/documents/:id', authFor('read'), (req, res) => {
  const doc = getDoc(req)
  if (!doc) { res.status(404).send('Not found'); return }
  res.send(docDetailPage(doc, getUser(req)))
})

// ── POST /documents/:id/edit ─────────────────────────────────────────────────

app.post('/documents/:id/edit', authFor('write'), (req, res) => {
  const doc = getDoc(req)
  if (!doc) { res.status(404).send('Not found'); return }
  // In a real app: save changes here
  res.send(docDetailPage(doc, getUser(req), {
    type:    'success',
    message: '✓ Document updated successfully.',
  }))
})

// ── POST /documents/:id/archive ───────────────────────────────────────────────

app.post('/documents/:id/archive', authFor('archive'), (req, res) => {
  const doc = getDoc(req)
  if (!doc) { res.status(404).send('Not found'); return }
  // In a real app: mark archived here
  res.send(docDetailPage(doc, getUser(req), {
    type:    'success',
    message: '✓ Document archived.',
  }))
})

// ── POST /documents/:id/delete ────────────────────────────────────────────────

app.post('/documents/:id/delete', authFor('delete'), (req, res) => {
  const doc = getDoc(req)
  if (!doc) { res.status(404).send('Not found'); return }
  // In a real app: delete here, redirect to list
  res.send(docDetailPage(doc, getUser(req), {
    type:    'success',
    message: '✓ Document deleted (demo — nothing was actually removed).',
  }))
})

// ─── Start ────────────────────────────────────────────────────────────────────

await devtools.start()

app.listen(APP_PORT, () => {
  console.log(`\n  App running at   http://localhost:${APP_PORT}`)
  console.log(`  DevTools at      http://localhost:${DEVTOOLS_PORT}\n`)
  console.log(`  Switch users with the ?as=... query param:`)
  console.log(`    admin   — full access`)
  console.log(`    alice   — editor + owns doc-1, doc-3, doc-5`)
  console.log(`    bob     — editor + owns doc-2, doc-4`)
  console.log(`    carol   — viewer (read published only)`)
  console.log(`    stranger — no roles (everything denied)\n`)
})
