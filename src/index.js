export const HUB_TYPES = ['front-office', 'back-office']

export const HUB_CORE_STATUS = 'scaffolded'

export * as requestContext from './request-context.js'
export { logger } from './logging/index.js'
export { createProxyPlugin } from './proxy-plugin.js'
export {
  JWT_ASSERTION_HEADER,
  COOKIES_POLICY_COOKIE_NAME
} from './proxy-plugin.js'
export { Spoke } from './spoke.js'
export { getServiceBaseUrl } from './get-service-base-url.js'
export { createServiceClient } from './service-client/index.js'
export {
  CIRCUIT_STATES,
  CircuitBreaker,
  CircuitOpenError
} from './circuit-breaker.js'
export { ServiceRequestError } from './service-client/service-request-error.js'
export { ServiceTokenError } from './service-token/service-token-error.js'
