import {AsyncLocalStorage} from 'node:async_hooks'

const storage = new AsyncLocalStorage()

export const plugin = {
  name: 'requestContext',
  version: '1.0.0',
  register(server) {
    server.ext('onRequest', (request, h) => {
      const store = new Map()

      store.set(
        'correlation_id',
          request.headers['x-cdp-request-id'] ||
          crypto.randomUUID()
      )

      for (const cycle of ['_lifecycle', '_postCycle']) {
        const original = request[cycle].bind(request)
        request[cycle] = () => storage.run(store, original)
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
