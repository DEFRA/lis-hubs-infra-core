import Boom from '@hapi/boom'

import { getServiceBaseUrl } from './get-service-base-url.js'
import { getServiceToken } from './service-token/issuer.js'
import { ServiceTokenError } from './service-token/service-token-error.js'
import { CircuitBreaker } from './circuit-breaker.js'

/** @import { CircuitOpenError } from './circuit-breaker.js' */

/**
 * The header the hub proxy sets on requests to spokes, carrying the signed-in
 * user's hub JWT. A spoke trusts it only after verifying the service token.
 */
export const JWT_ASSERTION_HEADER = 'x-lis-jwt-assertion'

/**
 * The GOV.UK cookie-consent cookie. It is the only browser cookie the proxy
 * forwards to spokes, so their pages can render the cookie banner state.
 * Must match the literal of the same name in @defra/lis-infra-ui-services,
 * which cannot import this server-only package into its browser bundle.
 */
export const COOKIES_POLICY_COOKIE_NAME = 'cookies_policy'

/**
 * The CSRF plugin's name, which keys its route options and request.plugins,
 * and the header a hub sends a spoke the session's CSRF token in. Both must
 * match CSRF_PLUGIN_NAME and CSRF_TOKEN_HEADER in
 * @defra/lis-infra-ui-services/csrf, which depends on this package, so this
 * one cannot import them.
 */
const CSRF_PLUGIN_NAME = 'lis-csrf'
export const CSRF_TOKEN_HEADER = 'x-lis-csrf-token'

const INTERNAL_SERVER_ERROR = 500
const BAD_GATEWAY = 502
const GENERIC_ERROR_MESSAGE = 'An internal server error occurred'

/**
 * @param {string | undefined} cookieHeader
 * @param {string} name
 * @returns {string | undefined} the raw `name=value` pair of the named cookie, encoding untouched, or undefined when absent
 */
function pickCookie(cookieHeader, name) {
  return cookieHeader
    ?.split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`))
}

/**
 * A module's app as a hub sees it: where it is, the mounts it is served at,
 * its circuit breaker, and the h2o2 routes that proxy to it.
 *
 * A mount is a URL pattern from the registry, such as
 * `/holdings/{cph*3}/cattle`. Requests under a mount are forwarded with their
 * path unchanged, so the spoke registers the same full patterns.
 */
export class Spoke {
  #serviceName
  #mounts
  #baseUri
  #timeout
  #getUserToken
  #breaker

  /**
   * @param {object} options
   * @param {string} options.moduleName - the module id from the registry
   * @param {string[]} options.mounts - the mount patterns the hub serves the spoke at
   * @param {number} options.port - the spoke's port, used for local environments only
   * @param {string} options.environment
   * @param {number} options.timeout - milliseconds to wait for the spoke's response headers before answering 504
   * @param {(request: object) => string | undefined | null} options.getUserToken - the signed-in user's hub JWT
   * @param {{ failureThreshold?: number, resetTimeout?: number }} [options.circuitBreaker] - see CircuitBreaker for the defaults
   */
  constructor({
    moduleName,
    mounts,
    port,
    environment,
    timeout,
    getUserToken,
    circuitBreaker = {}
  }) {
    if (!Array.isArray(mounts) || mounts.length === 0) {
      throw new Error(`Spoke ${moduleName} has no mounts`)
    }
    this.#serviceName = `lis-apps-${moduleName}`
    this.#mounts = mounts
    this.#baseUri = getServiceBaseUrl(
      environment,
      this.#serviceName,
      port
    ).origin
    this.#timeout = timeout
    this.#getUserToken = getUserToken
    this.#breaker = new CircuitBreaker({
      name: this.#serviceName,
      ...circuitBreaker
    })
  }

  /** @returns {string} */
  get serviceName() {
    return this.#serviceName
  }

  /** @returns {string[]} the mount patterns the hub serves the spoke at */
  get mounts() {
    return this.#mounts
  }

  /** @returns {CircuitBreaker} */
  get circuitBreaker() {
    return this.#breaker
  }

  /**
   * @returns {object[]} a hapi route proxying `${mount}/{path*}` to the
   * spoke for each mount
   */
  get routes() {
    return this.#mounts.map((mount) => ({
      method: '*',
      path: `${mount}/{path*}`,
      options: {
        plugins: {
          // The body is streamed through untouched, so the hub cannot read
          // the token in it; the spoke checks it against the token sent in
          // CSRF_TOKEN_HEADER. The hub still checks the origin.
          [CSRF_PLUGIN_NAME]: { token: false }
        }
      },
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
    }))
  }

  /**
   * h2o2 mapUri. Fails fast with a 503 while the spoke's circuit is open.
   *
   * The request path is forwarded unchanged, so the spoke sees the URL the
   * browser asked for.
   *
   * @param {object} request the hub request
   * @returns {Promise<{ uri: string, headers: object }>}
   * @throws {ServiceTokenError} naming the spoke, so the hub's error log says which one
   * @throws {CircuitOpenError} while the spoke's circuit is open
   */
  async mapUri(request) {
    const serviceToken = await this.#getServiceToken()
    const userToken = this.#getUserToken(request)
    const csrfToken = request.plugins?.[CSRF_PLUGIN_NAME]?.token
    // Nothing may throw between here and h2o2 making the call, or a
    // half-open probe would never report back.
    this.#breaker.assertCallAllowed()

    // passThrough copies request.headers itself and merges these headers on
    // top, so a header can only be withheld from the spoke by removing it
    // from the request. The spoke only gets the signed-in user's hub JWT,
    // taken from the hub session and sent in a header, the session's CSRF
    // token, likewise, and the cookie-consent cookie, never the hub session
    // cookie, the inbound authorization header or a client-supplied
    // assertion or CSRF token header.
    const forwardedCookies = pickCookie(
      request.headers.cookie,
      COOKIES_POLICY_COOKIE_NAME
    )
    delete request.headers.authorization
    delete request.headers.cookie
    delete request.headers[JWT_ASSERTION_HEADER]
    delete request.headers[CSRF_TOKEN_HEADER]

    return {
      uri: `${this.#baseUri}${request.path}${request.url.search}`,
      headers: {
        authorization: `Bearer ${serviceToken}`,
        ...(typeof userToken === 'string' &&
          userToken && { [JWT_ASSERTION_HEADER]: userToken }),
        ...(typeof csrfToken === 'string' &&
          csrfToken && { [CSRF_TOKEN_HEADER]: csrfToken }),
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
