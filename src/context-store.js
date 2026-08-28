import { AsyncLocalStorage } from 'node:async_hooks'

export class ContextStore {
  #storage = new AsyncLocalStorage()

  get #store() {
    const store = this.#storage.getStore()
    if (store === undefined) {
      throw new Error('No store available')
    }
    return store
  }

  /**
   * Checks if a value is in the current context.
   *
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    return !!this.#storage.getStore()?.has(key)
  }

  /**
   * Gets a value from the current context.
   * Returns null if no context is available or the key is not set.
   *
   * @param {string} key
   * @returns {string | number | boolean | null}
   */
  get(key) {
    return this.#storage.getStore()?.get(key) ?? null
  }

  /**
   * Returns every key/value pair in the current context.
   * Returns an empty object if no context is available.
   *
   * @returns {object}
   */
  getAll() {
    return Object.fromEntries((this.#storage.getStore() || new Map()).entries())
  }

  /**
   * Sets a primitive value in the current context.
   * Throws if called outside a context.
   *
   * @param {string} key
   * @param {string | number | boolean | null} value
   * @returns {void}
   */
  set(key, value) {
    this.#store.set(key, value)
  }

  /**
   * Removes a key from the current context.
   * Throws if called outside a context.
   *
   * @param {string} key
   * @returns {void}
   */
  clear(key) {
    this.#store.delete(key)
  }

  /**
   * Removes all keys from the current context.
   * Throws if called outside a context.
   * @returns {void}
   */
  clearAll() {
    this.#store.clear()
  }

  /**
   * Runs a callback with the given store active as the current context for
   * the duration of the call, per node:async_hooks AsyncLocalStorage#run.
   *
   * @param {Map} store
   * @param {Function} callback
   * @param {...*} args
   * @returns {*}
   */
  run(store, callback, ...args) {
    return this.#storage.run(store, callback, ...args)
  }
}
