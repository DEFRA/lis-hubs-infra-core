import h2o2 from '@hapi/h2o2'

import { getModulesForHub } from '@defra/lis-hubs-infra-registry'
import { Spoke } from './spoke.js'
import { positiveInteger } from './positive-integer.js'

const DEFAULT_PROXY_TIMEOUT_MS = 30000

/**
 * @param {object} options
 * @param {string} options.hubId
 * @param {string} options.environment
 * @param {string} options.hubJwtCookieName - the cookie that identifies the user to the spoke
 * @param {string[]} [options.forwardedCookieNames] - other browser cookies the spoke may see, such as the cookie consent choice; none by default
 * @param {number} [options.proxyTimeout] - milliseconds to wait for a spoke's response headers before answering 504; 30 seconds by default
 * @param {{ failureThreshold?: number, resetTimeout?: number }} [options.circuitBreaker] - per-spoke circuit breaker settings; see CircuitBreaker for the defaults
 * @returns {{ plugin: { name: string, register: Function } }}
 */
export function createProxyPlugin({
  hubId,
  environment,
  hubJwtCookieName,
  forwardedCookieNames = [],
  proxyTimeout = DEFAULT_PROXY_TIMEOUT_MS,
  circuitBreaker = {}
}) {
  if (!hubJwtCookieName) {
    throw new Error('hubJwtCookieName is required')
  }
  if (circuitBreaker === null || typeof circuitBreaker !== 'object') {
    throw new Error('circuitBreaker must be an object of settings')
  }
  if (
    !Array.isArray(forwardedCookieNames) ||
    forwardedCookieNames.some((name) => typeof name !== 'string' || !name)
  ) {
    throw new Error('forwardedCookieNames must be an array of cookie names')
  }

  const cookieNames = [hubJwtCookieName, ...forwardedCookieNames]
  const timeout = positiveInteger('proxyTimeout', proxyTimeout)

  // Longest path first, so a shorter prefix does not swallow a longer one.
  const spokes = getModulesForHub(hubId)
    .toSorted((a, b) => b.path.split('/').length - a.path.split('/').length)
    .map(
      ({ id: moduleName, path, port }) =>
        new Spoke({
          moduleName,
          path,
          port,
          environment,
          timeout,
          cookieNames,
          circuitBreaker
        })
    )

  return {
    plugin: {
      name: 'proxy',
      async register(server) {
        await server.register(h2o2)
        for (const spoke of spokes) {
          server.route(spoke.route)
        }
      }
    }
  }
}
