import { getServiceBaseUrl } from '../get-service-base-url.js'
import { CircuitBreaker } from '../circuit-breaker.js'
import { request } from './request.js'

/** @import { Service } from './request.js' */

const DEFAULT_TIMEOUT_MS = 3000

/**
 * @typedef {object} ServiceClientOptions
 * @property {string} environment
 * @property {string} serviceName - the target service
 * @property {number} [port] - its port when running locally
 * @property {string} [apiKey] - sent as x-api-key
 * @property {number} [timeout] - the total milliseconds allowed for the
 *   response headers and body, default 3000
 * @property {{ failureThreshold?: number, resetTimeout?: number } | false} [circuitBreaker]
 *   configures the service's breaker (see CircuitBreaker for the defaults),
 *   or disables it with false
 */

/**
 * @typedef {(path: string, options?: object) => Promise<{ res: object, payload: object }>} ServiceCall
 *   takes a path relative to the service's base URL and Wreck request
 *   options; resolves with the Wreck result
 */

/**
 * @typedef {object} ServiceClient
 * @property {ServiceCall} get
 * @property {ServiceCall} post
 * @property {ServiceCall} put
 * @property {ServiceCall} patch
 * @property {ServiceCall} delete
 */

/**
 * A Wreck wrapper for a BE4FE or other upstream service, shared across
 * spokes and hubs. It resolves its own base URL, and adds the correlation
 * headers, service token, API key, timeout and circuit breaker to every
 * call. Build a client on it by giving named functions the verbs:
 *
 *   const service = createServiceClient({ environment, serviceName })
 *   export const getAnimal = (id) =>
 *     service.get(`animals/${id}`).then(({ payload }) => payload)
 *
 * Nothing it holds can be reached or replaced from outside, and the verbs
 * do not depend on `this`, so they can be passed around freely.
 * @param {ServiceClientOptions} options
 * @returns {ServiceClient}
 */
export function createServiceClient({
  environment,
  serviceName,
  port,
  apiKey,
  timeout = DEFAULT_TIMEOUT_MS,
  circuitBreaker = {}
}) {
  /** @type {Service} */
  const service = {
    serviceName,
    baseUrl: getServiceBaseUrl(environment, serviceName, port).origin,
    apiKey,
    timeout,
    breaker:
      circuitBreaker === false
        ? null
        : new CircuitBreaker({ name: serviceName, ...circuitBreaker })
  }

  return Object.freeze({
    get: (path, options) => request(service, 'GET', path, options),
    post: (path, options) => request(service, 'POST', path, options),
    put: (path, options) => request(service, 'PUT', path, options),
    patch: (path, options) => request(service, 'PATCH', path, options),
    delete: (path, options) => request(service, 'DELETE', path, options)
  })
}
