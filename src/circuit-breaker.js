import Boom from '@hapi/boom'

import { logger } from './logging/index.js'
import { positiveInteger } from './positive-integer.js'

const SERVICE_UNAVAILABLE = 503
const GENERIC_ERROR_MESSAGE = 'An internal server error occurred'
const DEFAULT_FAILURE_THRESHOLD = 5
const DEFAULT_RESET_TIMEOUT_MS = 30000

export const CIRCUIT_STATES = Object.freeze({
  CLOSED: 'closed',
  OPEN: 'open',
  HALF_OPEN: 'half-open'
})

/**
 * Thrown instead of making a call while the circuit is open. It is a 503 Boom
 * error, so hapi answers with that status unaided and the UI catch-all renders
 * the "service unavailable, try again later" page. It boomifies itself rather
 * than extending Boom, whose constructor returns a new object and so breaks
 * subclassing. The response body stays generic: the message names the
 * downstream service, which the browser must not see.
 */
export class CircuitOpenError extends Error {
  name = 'CircuitOpenError'
  statusCode = SERVICE_UNAVAILABLE

  /** @param {string} message */
  constructor(message) {
    super(message)
    Boom.boomify(this, { statusCode: SERVICE_UNAVAILABLE })
    this.output.payload.message = GENERIC_ERROR_MESSAGE
  }
}

/**
 * A circuit breaker for calls to one downstream service, held by whoever makes
 * them. It only knows about outcomes it is told: a caller should count
 * transport failures (connection refused, timeout) and never an upstream
 * status code, which proves the service is up.
 *
 * Closed: calls go through; `failureThreshold` consecutive failures open it.
 * Open: calls fail fast with CircuitOpenError for `resetTimeout` ms.
 * Half-open: one probe call goes through, others fail fast; its success
 * closes the circuit, its failure reopens it for another `resetTimeout`.
 */
export class CircuitBreaker {
  #name
  #failureThreshold
  #resetTimeout
  #now
  #state = CIRCUIT_STATES.CLOSED
  #consecutiveFailures = 0
  #openedAt = 0
  #probeInFlight = false

  /**
   * @param {{ name: string, failureThreshold?: number, resetTimeout?: number, now?: () => number }} options name identifies the downstream service in errors; resetTimeout is in milliseconds; now is for tests
   */
  constructor({
    name,
    failureThreshold = DEFAULT_FAILURE_THRESHOLD,
    resetTimeout = DEFAULT_RESET_TIMEOUT_MS,
    now = Date.now
  }) {
    if (!name) {
      throw new Error('name is required')
    }
    this.#name = name
    this.#failureThreshold = positiveInteger(
      'failureThreshold',
      failureThreshold
    )
    this.#resetTimeout = positiveInteger('resetTimeout', resetTimeout)
    this.#now = now
  }

  /** @returns {string} the downstream service's name */
  get name() {
    return this.#name
  }

  /** @returns {'closed' | 'open' | 'half-open'} */
  get state() {
    if (
      this.#state === CIRCUIT_STATES.OPEN &&
      this.#now() - this.#openedAt >= this.#resetTimeout
    ) {
      this.#state = CIRCUIT_STATES.HALF_OPEN
      this.#probeInFlight = false
      logger.info(
        `Circuit half-open for ${this.#name}; letting one probe call through`
      )
    }
    return this.#state
  }

  /**
   * Call immediately before making the downstream call, and pair it with
   * recordSuccess or recordFailure for the outcome: a half-open probe that
   * never reports back leaves the circuit failing fast until it does.
   *
   * @throws {CircuitOpenError} when the call must not be made
   */
  assertCallAllowed() {
    const state = this.state
    if (state === CIRCUIT_STATES.CLOSED) {
      return
    }
    if (state === CIRCUIT_STATES.HALF_OPEN && !this.#probeInFlight) {
      this.#probeInFlight = true
      return
    }
    throw new CircuitOpenError(`Circuit open for ${this.#name}`)
  }

  /**
   * The downstream service answered, whatever it said. A straggler from
   * before the circuit opened is ignored: only the probe may close it.
   */
  recordSuccess() {
    const state = this.state
    if (state === CIRCUIT_STATES.OPEN) {
      return
    }
    if (state === CIRCUIT_STATES.HALF_OPEN) {
      logger.info(`Circuit closed for ${this.#name}; the probe call succeeded`)
    }
    this.#state = CIRCUIT_STATES.CLOSED
    this.#consecutiveFailures = 0
    this.#probeInFlight = false
  }

  /**
   * The downstream service could not be reached or did not answer in time.
   * A straggler from before the circuit opened is ignored, so it does not
   * extend the open window.
   */
  recordFailure() {
    const state = this.state
    if (state === CIRCUIT_STATES.OPEN) {
      return
    }
    this.#consecutiveFailures += 1
    if (
      state === CIRCUIT_STATES.HALF_OPEN ||
      this.#consecutiveFailures >= this.#failureThreshold
    ) {
      this.#open()
    }
  }

  #open() {
    const reason =
      this.#state === CIRCUIT_STATES.HALF_OPEN
        ? 'the probe call failed'
        : `${this.#consecutiveFailures} consecutive transport failures`
    this.#state = CIRCUIT_STATES.OPEN
    this.#openedAt = this.#now()
    this.#probeInFlight = false
    logger.warn(
      `Circuit opened for ${this.#name} after ${reason}; failing fast for ${this.#resetTimeout}ms`
    )
  }
}
