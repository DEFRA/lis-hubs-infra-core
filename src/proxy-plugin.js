import h2o2 from '@hapi/h2o2'

import { getModulesForHub } from '@defra/lis-hubs-infra-registry'
import { Spoke } from './spoke.js'
import { positiveInteger } from './positive-integer.js'

export { JWT_ASSERTION_HEADER, COOKIES_POLICY_COOKIE_NAME } from './spoke.js'

const DEFAULT_PROXY_TIMEOUT_MS = 30000

/**
 * @param {object} options
 * @param {string} options.hubId
 * @param {string} options.environment
 * @param {(request: object) => string | undefined | null} options.getUserToken - the hub JWT of the signed-in user, sent to the spoke in the JWT_ASSERTION_HEADER header
 * @param {number} [options.proxyTimeout] - milliseconds to wait for a spoke's response headers before answering 504; 30 seconds by default
 * @param {{ failureThreshold?: number, resetTimeout?: number }} [options.circuitBreaker] - per-spoke circuit breaker settings; see CircuitBreaker for the defaults
 * @returns {{ plugin: { name: string, register: Function } }}
 */
export function createProxyPlugin({
  hubId,
  environment,
  getUserToken,
  proxyTimeout = DEFAULT_PROXY_TIMEOUT_MS,
  circuitBreaker = {}
}) {
  if (typeof getUserToken !== 'function') {
    throw new TypeError('createProxyPlugin requires a getUserToken function')
  }
  if (circuitBreaker === null || typeof circuitBreaker !== 'object') {
    throw new Error('circuitBreaker must be an object of settings')
  }

  const timeout = positiveInteger('proxyTimeout', proxyTimeout)

  // One route per mount; hapi matches by specificity, so a verb spoke under
  // a species home wins without any ordering here.
  const spokes = getModulesForHub(hubId).map(
    ({ id: moduleName, mounts, port }) =>
      new Spoke({
        moduleName,
        mounts: Object.values(mounts),
        port,
        environment,
        timeout,
        getUserToken,
        circuitBreaker
      })
  )

  return {
    plugin: {
      name: 'proxy',
      async register(server) {
        await server.register(h2o2)
        for (const spoke of spokes) {
          server.route(spoke.routes)
        }
      }
    }
  }
}
