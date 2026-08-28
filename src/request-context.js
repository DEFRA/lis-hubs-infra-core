import { ContextStore } from './context-store.js'
import { logger } from './logging/index.js'
const contextStore = new ContextStore()

export const plugin = {
  name: 'requestContext',
  version: '1.0.0',
  register(server) {
    server.ext('onRequest', onRequest)
  }
}

/**
 * Seeds correlation_id from the x-cdp-request-id header (generating one if
 * missing) into a fresh request-scoped store, then wraps the request's
 * lifecycle so that store - and a matching logger.context store - stay
 * active for the rest of the request.
 *
 * @param {object} request
 * @param {object} h
 * @returns {symbol} h.continue
 */
function onRequest(request, h) {
  const initialStore = new Map()
  const correlationId =
    request.headers['x-cdp-request-id'] || crypto.randomUUID()
  initialStore.set(`correlation_id`, correlationId)
  // A single Map, shared by reference across both cycles below - not a
  // fresh Map per cycle, or anything set into logger.context during
  // _lifecycle (e.g. hydrateAuthorization's user_email_hash, set from
  // onPreAuth) would be invisible to _reply, which is where hapi-pino's
  // response log line actually fires.
  const logContextStore = new Map(initialStore)

  // _lifecycle covers routing through the handler; _reply covers
  // everything after (including _postCycle, _abort and _finalize,
  // which _reply calls internally) - notably _finalize is where Hapi
  // emits the 'response' event that hapi-pino's request-summary log
  // line listens to. Wrapping _postCycle alone left _finalize running
  // after the storage.run() call for _postCycle had already returned,
  // so context set during the request (e.g. via onPreAuth) never
  // reached that log line - context does not survive back across an
  // awaited storage.run() call into an unwrapped caller.
  for (const cycle of ['_lifecycle', '_reply']) {
    wrapLifecycleHook(request, cycle, initialStore, logContextStore)
  }
  return h.continue
}

/**
 * Replaces request[cycle] with a version that runs the original inside both
 * contextStore and logger.context, so both stores are active for the
 * duration of that lifecycle hook.
 *
 * @param {object} request
 * @param {string} cycle - '_lifecycle' or '_reply'
 * @param {Map} initialStore
 * @param {Map} logContextStore
 * @returns {void}
 */
function wrapLifecycleHook(request, cycle, initialStore, logContextStore) {
  const original = request[cycle].bind(request)
  request[cycle] = (...args) =>
    contextStore.run(initialStore, () =>
      logger.context.run(logContextStore, () => original(...args))
    )
}

export const has = contextStore.has.bind(contextStore)
export const get = contextStore.get.bind(contextStore)
export const set = contextStore.set.bind(contextStore)
export const clear = contextStore.clear.bind(contextStore)
export const clearAll = contextStore.clearAll.bind(contextStore)

/**
 * Reads the current request context and returns the headers for
 * consumers to attach to their own outbound requests to other internal
 * LIS services.
 * @returns {object}
 */
export function getHeaders() {
  const headers = {}
  if (has('correlation_id')) {
    headers['x-cdp-request-id'] = get('correlation_id')
  }
  return headers
}
