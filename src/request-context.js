import { AsyncLocalStorage } from 'node:async_hooks'

const storage = new AsyncLocalStorage()

const lisHeaderKeys = {
  origin_service: 'x-lis-origin-service',
  cph: 'x-lis-cph-number',
  animal_id: 'x-lis-animal-id',
  user_id: 'x-lis-user-id'
}

const headerKeys = { ...lisHeaderKeys, correlation_id: 'x-cdp-request-id' }

/**
 * Maps whichever x-lis-* (and correlation) headers are present on an
 * inbound request onto their corresponding request context keys. The
 * x-lis-* headers are only ever trusted from an internal caller (a spoke
 * receiving them from a hub's own proxy) - anyone can set an arbitrary
 * header on a request, so a hub (the public-facing entry point) must
 * never trust them from its own inbound requests, or a client could
 * inject a fake user_id/cph/origin_service into its logs.
 * @param {object} headers
 * @param {boolean} trustLisHeaders
 * @returns {object}
 */
const parseHeaders = (headers, trustLisHeaders) => {
  const context = {}
  const keysToParse = trustLisHeaders
    ? headerKeys
    : { correlation_id: headerKeys.correlation_id }

  for (const [key, header] of Object.entries(keysToParse)) {
    const value = headers[header]
    if (value) {
      context[key] = value
    }
  }
  return context
}

export const plugin = {
  name: 'requestContext',
  version: '1.0.0',
  register(server, options = {}) {
    const { trustLisHeaders = false } = options

    server.ext('onRequest', (request, h) => {
      const store = new Map()
      const context = parseHeaders(request.headers, trustLisHeaders)

      if (!context.correlation_id) {
        context.correlation_id = crypto.randomUUID()
      }

      for (const [key, value] of Object.entries(context)) {
        store.set(key, value)
      }

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
        const original = request[cycle].bind(request)
        request[cycle] = (...args) => storage.run(store, original, ...args)
      }
      return h.continue
    })
  }
}

const getStore = () => {
  const store = storage.getStore()
  if (store === undefined) {
    throw new Error('No request context available')
  }
  return store
}

/**
 * Gets a value from the current request context.
 * Returns null if no context is available or the key is not set.
 *
 * @param {string} key
 * @returns {string | number | boolean | null}
 */
export const get = (key) => storage.getStore()?.get(key) ?? null

/**
 * Sets a primitive value in the current request context.
 * Throws if called outside a request context.
 *
 * @param {string} key
 * @param {string | number | boolean | null} value
 * @returns {void}
 */
export const set = (key, value) => {
  getStore().set(key, value)
}

/**
 * Removes a key from the current request context.
 * Throws if called outside a request context.
 *
 * @param {string} key
 * @returns {void}
 */
export const clear = (key) => {
  getStore().delete(key)
}

/**
 * Removes all keys from the current request context.
 * Throws if called outside a request context.
 * @returns {void}
 */
export const clearAll = () => {
  getStore().clear()
}

/**
 * Reads the current request context and returns the x-lis-* headers for
 * whichever values are set, for consumers to attach to their own outbound
 * requests to other internal LIS services.
 * @returns {object}
 */
export function getHeaders() {
  const headers = {}

  for (const [key, header] of Object.entries(headerKeys)) {
    const value = get(key)
    if (value) {
      headers[header] = value
    }
  }

  return headers
}
