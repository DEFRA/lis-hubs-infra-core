import Wreck from '@hapi/wreck'

import { ServiceRequestError } from './service-request-error.js'
import { buildHeaders } from './headers.js'

/** @import { FailedCall } from './service-request-error.js' */

/** @import { CircuitBreaker } from '../circuit-breaker.js' */

/**
 * @typedef {object} Service - what a client holds about its service; never
 *   leaves this directory
 * @property {string} serviceName
 * @property {string} baseUrl
 * @property {string} [apiKey]
 * @property {number} timeout
 * @property {CircuitBreaker | null} breaker
 */

const BAD_REQUEST = 400
const REQUEST_TIMEOUT = 408
const GATEWAY_TIMEOUT = 504

/**
 * Asks the question the way the transport will answer it, by resolving the
 * path, so that nothing a URL parser forgives (backslashes, leading spaces,
 * tabs and newlines) gets a path past it.
 * @param {string} path
 * @param {string} baseUrl - the service's origin
 * @returns {boolean} whether the path would take the call to another host
 */
function leavesService(path, baseUrl) {
  try {
    return new URL(path, baseUrl).origin !== baseUrl
  } catch {
    return true
  }
}

/**
 * @param {Service} service
 * @param {FailedCall} call
 * @param {object} options - the Wreck request options
 * @returns {Promise<object>} the response, once its headers have arrived
 */
async function send({ breaker }, call, options) {
  try {
    return await Wreck.request(call.method, call.path, options)
  } catch (cause) {
    breaker?.recordFailure()
    throw ServiceRequestError.fromTransportError(call, cause)
  }
}

/**
 * @param {Service} service
 * @param {FailedCall} call
 * @param {object} res - the response
 * @param {object} options - the Wreck request options, with what is left of
 *   the timeout
 * @returns {Promise<object>} the body
 */
async function read({ breaker }, call, res, options) {
  let payload

  try {
    payload = await Wreck.read(res, options)
  } catch (cause) {
    // Wreck reports a body read timeout as a 408; from the caller's point
    // of view it is a gateway timeout, as a headers timeout already is. Any
    // other read failure (bad JSON, too large) is a response, which proves
    // the service is up.
    const timedOut = cause.output?.statusCode === REQUEST_TIMEOUT
    if (timedOut) {
      breaker?.recordFailure()
    } else {
      breaker?.recordSuccess()
    }
    throw ServiceRequestError.fromReadError(
      call,
      timedOut ? GATEWAY_TIMEOUT : res.statusCode,
      cause
    )
  }

  // Any response proves the service is up, whatever it answered.
  breaker?.recordSuccess()
  return payload
}

/**
 * @param {Service} service
 * @param {string} method
 * @param {string} path
 * @param {object} [callerOptions]
 * @returns {Promise<{ res: object, payload: object }>}
 * @throws {ServiceRequestError} when the call fails
 */
export async function request(service, method, path, callerOptions = {}) {
  // An absolute URL would send the service token to a host other than this
  // client's own service.
  if (leavesService(path, service.baseUrl)) {
    throw new Error(
      'Service client paths must be relative to the service base URL'
    )
  }

  const { serviceName, baseUrl, timeout, breaker } = service
  const call = { serviceName, method, path }
  const options = {
    json: true,
    ...callerOptions,
    baseUrl,
    timeout,
    headers: await buildHeaders(service, callerOptions.headers)
  }
  // Nothing may throw between here and the transport call, or a half-open
  // probe would never report back.
  breaker?.assertCallAllowed()
  const startedAt = Date.now()
  const res = await send(service, call, options)
  // The body read gets what is left of the overall timeout, so a slow
  // service cannot take twice the budget by stalling after its headers.
  const payload = await read(service, call, res, {
    ...options,
    timeout: Math.max(timeout - (Date.now() - startedAt), 1)
  })

  if (res.statusCode >= BAD_REQUEST) {
    throw ServiceRequestError.fromResponse(call, res.statusCode, payload)
  }

  return { res, payload }
}
