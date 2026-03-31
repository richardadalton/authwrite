import * as http   from 'node:http'
import * as fs     from 'node:fs'
import * as path   from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DevToolsObserver, DecisionFlag, PersistedDecision } from './observer.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export interface PolicySwitcherOptions {
  /** Directory to scan for .yaml, .yml, and .json policy files. */
  dir: string
  /**
   * Called when the user selects and applies a policy file from the sidebar.
   * Receives the full absolute path to the selected file.
   */
  onApply: (filePath: string) => Promise<void>
}

export interface DevServerOptions {
  observer:    DevToolsObserver
  port?:       number
  /**
   * Path to write flagged decisions. Defaults to `.authwrite-flags.json`
   * in the current working directory.
   */
  flagsFile?:  string
  /**
   * Optional policy switcher. When provided, the devtools sidebar shows a
   * dropdown of policy files in the given directory and an Apply button that
   * calls onApply with the selected file path.
   */
  policies?:   PolicySwitcherOptions
}

export interface DevServer {
  start():  Promise<void>
  stop():   Promise<void>
  readonly url: string
}

export function createDevServer(options: DevServerOptions): DevServer {
  const { observer, port = 4999, flagsFile = '.authwrite-flags.json' } = options
  const serverUrl = `http://localhost:${port}`

  // ── SSE client registry ────────────────────────────────────────────────────

  const sseClients = new Set<http.ServerResponse>()

  observer.subscribe((decision) => broadcast(decision))

  function broadcast(decision: PersistedDecision) {
    const line = `data: ${JSON.stringify(decision)}\n\n`
    for (const client of sseClients) {
      try {
        client.write(line)
      } catch {
        sseClients.delete(client)
      }
    }
  }

  // ── HTTP server ────────────────────────────────────────────────────────────

  const server = http.createServer((req, res) => {
    // CORS — allow any localhost origin to connect
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url ?? '/', serverUrl)

    // ── GET /devtools-client.js ──────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/devtools-client.js') {
      const clientPath = path.join(__dirname, 'devtools-client.js')
      try {
        const content = fs.readFileSync(clientPath, 'utf-8')
        // Rewrite __DEVTOOLS_PORT__ at serve time so the bundle always uses
        // whatever port this server is running on
        const patched = content.replace(/__DEVTOOLS_PORT__/g, String(port))
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
        res.writeHead(200)
        res.end(patched)
      } catch {
        res.writeHead(404)
        res.end('Client bundle not found — run npm run build in @daltonr/authwrite-devtools')
      }
      return
    }

    // ── GET /events  (SSE decision stream) ──────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/events') {
      res.setHeader('Content-Type',  'text/event-stream; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection',    'keep-alive')
      res.writeHead(200)

      // Replay history so a late-connecting sidebar sees existing decisions
      for (const d of observer.getBuffer()) {
        res.write(`data: ${JSON.stringify(d)}\n\n`)
      }

      sseClients.add(res)
      req.on('close', () => sseClients.delete(res))
      return
    }

    // ── GET /policies ────────────────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/policies') {
      res.setHeader('Content-Type', 'application/json')
      if (!options.policies) {
        res.writeHead(200)
        res.end(JSON.stringify({ configured: false, files: [] }))
        return
      }
      try {
        const entries = fs.readdirSync(options.policies.dir)
        const files = entries
          .filter(f => /\.(yaml|yml|json)$/.test(f))
          .sort()
        res.writeHead(200)
        res.end(JSON.stringify({ configured: true, dir: options.policies.dir, files }))
      } catch {
        res.writeHead(200)
        res.end(JSON.stringify({ configured: true, dir: options.policies.dir, files: [], error: 'Could not read directory' }))
      }
      return
    }

    // ── POST /policies/apply ─────────────────────────────────────────────────
    if (req.method === 'POST' && url.pathname === '/policies/apply') {
      if (!options.policies) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Policy switcher not configured' }))
        return
      }
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', async () => {
        try {
          const { file } = JSON.parse(body) as { file: string }
          if (!file || typeof file !== 'string' || file.includes('..')) {
            res.writeHead(400)
            res.end(JSON.stringify({ error: 'invalid file' }))
            return
          }
          const fullPath = path.join(options.policies!.dir, file)
          await options.policies!.onApply(fullPath)
          res.setHeader('Content-Type', 'application/json')
          res.writeHead(200)
          res.end(JSON.stringify({ ok: true, file }))
        } catch (err) {
          res.setHeader('Content-Type', 'application/json')
          res.writeHead(500)
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Apply failed' }))
        }
      })
      return
    }

    // ── POST /flag ───────────────────────────────────────────────────────────
    if (req.method === 'POST' && url.pathname === '/flag') {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        try {
          const { id, verdict, note } = JSON.parse(body) as {
            id: string; verdict: string; note: string
          }

          const decision = observer.getBuffer().find(d => d.id === id)
          if (!decision) {
            res.writeHead(404)
            res.end(JSON.stringify({ error: 'decision not found' }))
            return
          }

          if (verdict !== 'should-allow' && verdict !== 'should-deny') {
            res.writeHead(400)
            res.end(JSON.stringify({ error: 'invalid verdict' }))
            return
          }

          const flag: DecisionFlag = {
            decisionId: id,
            verdict: verdict as DecisionFlag['verdict'],
            note,
            flaggedAt: Date.now(),
            decision,
          }

          appendFlag(flagsFile, flag)

          res.setHeader('Content-Type', 'application/json')
          res.writeHead(201)
          res.end(JSON.stringify({ ok: true }))
        } catch {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'invalid body' }))
        }
      })
      return
    }

    res.writeHead(404)
    res.end()
  })

  return {
    get url() { return serverUrl },

    start(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.on('error', reject)
        server.listen(port, () => {
          console.log(`\n  [authwrite devtools] http://localhost:${port}`)
          console.log(`  Add to your HTML (dev only):\n`)
          console.log(`    <script src="${serverUrl}/devtools-client.js"></script>\n`)
          resolve()
        })
      })
    },

    stop(): Promise<void> {
      sseClients.forEach(c => c.end())
      sseClients.clear()
      return new Promise((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()))
      })
    },
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function appendFlag(filePath: string, flag: DecisionFlag): void {
  let flags: DecisionFlag[] = []
  try {
    flags = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    // File doesn't exist yet — start fresh
  }
  flags.push(flag)
  fs.writeFileSync(filePath, JSON.stringify(flags, null, 2))
}
