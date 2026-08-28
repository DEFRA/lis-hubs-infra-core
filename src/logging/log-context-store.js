import { ContextStore } from '../context-store.js'
import { createHmac } from 'node:crypto'

export class LogContextStore extends ContextStore {
  #logger
  #hashSecret

  /**
   * @param {{ logger?: object }} options - logger used to warn when a
   *   hashed set() is attempted before hashSecret has been configured.
   */
  constructor(options = {}) {
    super()
    this.#logger = options.logger
  }

  /**
   * @param {string} value
   * @returns {string | null} the HMAC-SHA256 hex digest of value, or null
   *   if hashSecret has not been set.
   */
  #hash(value) {
    if (!this.#hashSecret) {
      this.#logger.warn(
        '[LogContextStore] Cannot hash context value, hash secret not set.'
      )
      return null
    }
    return createHmac('sha256', this.#hashSecret).update(value).digest('hex')
  }

  /**
   * Always returns null - the configured secret is never readable once set.
   *
   * @returns {null}
   */
  get hashSecret() {
    return null
  }

  /**
   * Sets the fixed key used to hash context values via set(key, value, true).
   * Throws if a secret has already been set - it must not be reassigned at
   * runtime.
   *
   * @param {string} value
   * @returns {void}
   */
  set hashSecret(value) {
    if (this.#hashSecret) {
      throw new Error('Hash secret already set')
    }
    this.#hashSecret = value
  }

  /**
   * Gets a value from the current context.
   * Returns null if no context is available or the key is not set.
   *
   * @param {string} key
   * @returns {string | null}
   */
  get(key) {
    return super.get(key)
  }

  /**
   * Sets a primitive value in the current context.
   * Throws if called outside a context.
   *
   * @param {string} key
   * @param {string} value
   * @param {boolean} hash
   * @returns {void}
   */
  set(key, value, hash = false) {
    if (!hash || value === '') {
      super.set(key, value)
      return
    }
    const hashedValue = this.#hash(value)
    if (hashedValue) {
      super.set(key, hashedValue)
    }
  }
}
