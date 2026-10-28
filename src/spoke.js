import Boom from '@hapi/boom'

import { getServiceBaseUrl } from './get-service-base-url.js'
import { getServiceToken } from './service-token/issuer.js'
import { ServiceTokenError } from './base-client.js'
import { CircuitBreaker } from './circuit-breaker.js'

/** @import { CircuitOpenError } from './circuit-breaker.js' */

const INTERNAL_SERVER_ERROR = 500
const BAD_GATEWAY = 502
const GENERIC_ERROR_MESSAGE = 'An internal server error occurred'

/**
 * @param {string | undefined} cookieHeader
 * @param {string[]} names
 * @returns {string | undefined} a cookie header of the named cookies that are present, in the browser's order, raw `name=value` pairs with encoding untouched
 */
function pickCookies(cookieHeader, names) {
  const picked = cookieHeader
    ?.split(';')
    .map((cookie) => cookie.trim())
    .filter((cookie) => names.some((name) => cookie.startsWith(`${name}=`)))

  return picked?.length ? picked.join('; ') : undefined
}

/**
 * A module's app as a hub sees it: where it is, the path it is mounted at,
 * its circuit breaker, and the h2o2 route that proxies to it.
 */
export class Spoke {
  #serviceName
  #path
  #baseUri
  #timeout
  #cookieNames
  #breaker

  /**
   * @param {object} options
   * @param {string} options.moduleName - the module id from the registry
   * @param {string} options.path - the hub path prefix the spoke is mounted at
   * @param {number} options.port - the spoke's port, used for local environments only
   * @param {string} options.environment
   * @param {number} options.timeout - milliseconds to wait for the spoke's response headers before answering 504
   * @param {string[]} options.cookieNames - the browser cookies the spoke may see
   * @param {{ failureThreshold?: number, resetTimeout?: number }} [options.circuitBreaker] - see CircuitBreaker for the defaults
   */
  constructor({
    moduleName,
    path,
    port,
    environment,
    timeout,
    cookieNames,
    circuitBreaker = {}
  }) {
    this.#serviceName = `lis-apps-${moduleName}`
    this.#path = path
    this.#baseUri = getServiceBaseUrl(
      environment,
      this.#serviceName,
      port
    ).origin
    this.#timeout = timeout
    this.#cookieNames = cookieNames
    this.#breaker = new CircuitBreaker({
      name: this.#serviceName,
      ...circuitBreaker
    })
  }

  /** @returns {string} */
  get serviceName() {
    return this.#serviceName
  }

  /** @returns {string} the hub path prefix the spoke is mounted at */
  get path() {
    return this.#path
  }

  /** @returns {CircuitBreaker} */
  get circuitBreaker() {
    return this.#breaker
  }

  /**
   * @returns {object} a hapi route proxying `${path}/{path*}` to the spoke
   */
  get route() {
    return {
      method: '*',
      path: `${this.#path}/{path*}`,
      handler: {
        proxy: {
          passThrough: true,
          xforward: true,
          timeout: this.#timeout,
          mapUri: (request) => this.mapUri(request),
          onResponse: (err, res, request, h) =>
            this.onResponse(err, res, request, h)
        }
      }
    }
  }

  /**
   * h2o2 mapUri. Fails fast with a 503 while the spoke's circuit is open.
   *
   * @param {object} request the hub request
   * @returns {Promise<{ uri: string, headers: object }>}
   * @throws {ServiceTokenError} naming the spoke, so the hub's error log says which one
   * @throws {CircuitOpenError} while the spoke's circuit is open
   */
  async mapUri(request) {
    const serviceToken = await this.#getServiceToken()
    // Nothing may throw between here and h2o2 making the call, or a
    // half-open probe would never report back.
    this.#breaker.assertCallAllowed()
    const subPath = request.params.path ?? ''
    const uri =
      (subPath ? `${this.#baseUri}/${subPath}` : this.#baseUri) +
      request.url.search

    // passThrough copies request.headers itself and merges these headers on
    // top, so a header can only be withheld from the spoke by removing it
    // from the request. The spoke only gets the hub JWT cookie and the
    // cookies named as forwarded, never the hub's session or credentials.
    const forwardedCookies = pickCookies(
      request.headers.cookie,
      this.#cookieNames
    )
    delete request.headers.authorization
    delete request.headers.cookie

    return {
      uri,
      headers: {
        'x-forwarded-prefix': this.#path,
        authorization: `Bearer ${serviceToken}`,
        ...(forwardedCookies && { cookie: forwardedCookies })
      }
    }
  }

  /**
   * h2o2 onResponse. An upstream failure becomes a Boom error naming the
   * spoke, keeping the upstream status, so the hub's error handler logs it
   * once with that context, while the response body stays generic. A
   * response is passed through as h2o2 does by default.
   *
   * Only a transport failure (no response at all: connection refused,
   * timeout, which h2o2 reports as a 502 or 504, or with no status) counts
   * against the circuit breaker. A response, whatever its status, or an
   * error on the browser's side of the proxy, proves nothing about the spoke.
   *
   * @param {Error | null} err
   * @param {object} res the spoke's response
   * @param {object} _request
   * @param {object} h the hapi response toolkit
   * @returns {object} a Boom error or a hapi response
   */
  onResponse(err, res, _request, h) {
    if (err) {
      const statusCode = err.output?.statusCode ?? BAD_GATEWAY
      if (statusCode >= INTERNAL_SERVER_ERROR) {
        this.#breaker.recordFailure()
      }
      const wrapped = new Error(
        `Spoke ${this.#serviceName} request failed: ${err.message}`,
        { cause: err }
      )
      const boom = Boom.boomify(wrapped, { statusCode })
      // Boom only hides the message of a 500; this one names the spoke and
      // the upstream address, which the browser must not see.
      boom.output.payload.message = GENERIC_ERROR_MESSAGE
      return boom
    }
    this.#breaker.recordSuccess()
    return h.response(res).code(res.statusCode).passThrough(true)
  }

  async #getServiceToken() {
    try {
      return await getServiceToken(this.#serviceName)
    } catch (err) {
      throw new ServiceTokenError(
        `Service token unavailable for spoke ${this.#serviceName}`,
        { cause: err }
      )
    }
  }
}
