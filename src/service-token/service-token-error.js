const SERVICE_UNAVAILABLE = 503

/**
 * Thrown when a service token for the target service cannot be obtained, so
 * the call is never made.
 */
export class ServiceTokenError extends Error {
  name = 'ServiceTokenError'
  statusCode = SERVICE_UNAVAILABLE
}
