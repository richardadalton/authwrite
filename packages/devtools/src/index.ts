export { DevToolsObserver }    from './observer.js'
export { createDevServer }     from './server.js'
export type { PersistedDecision, DecisionFlag } from './observer.js'
export type { DevServerOptions, DevServer }     from './server.js'

import { DevToolsObserver }  from './observer.js'
import { createDevServer }   from './server.js'

export interface CreateDevToolsOptions {
  port?:      number
  flagsFile?: string
}

/**
 * Convenience factory — creates an observer and a dev server together.
 *
 * ```typescript
 * // In development only:
 * const devtools = createDevTools({ port: 4999 })
 * engine.addObserver(devtools.observer)   // or pass to createAuthEngine({ observers })
 * await devtools.start()
 * // Then add to your HTML:
 * //   <script src="http://localhost:4999/devtools-client.js"></script>
 * ```
 */
export function createDevTools(options: CreateDevToolsOptions = {}) {
  const observer = new DevToolsObserver()
  const server   = createDevServer({ ...options, observer })

  return {
    observer,
    start: () => server.start(),
    stop:  () => server.stop(),
    get url() { return server.url },
  }
}
