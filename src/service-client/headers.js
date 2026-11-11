import * as requestContext from '../request-context.js'
import { getServiceToken } from '../service-token/issuer.js'
import { ServiceTokenError } from '../service-token/service-token-error.js'

/** @import { Service } from './request.js' */

// The service token and API key are the client's to set, never the caller's
const RESERVED_HEADERS = ['authorization', 'x-api-key']

/**
 * @param {object} callerHeaders - headers supplied on this call
 * @returns {object} those the caller may set
 */
function withoutReserved(callerHeaders) {
  return Object.fromEntries(
    Object.entries(callerHeaders).filter(
      ([key]) => !RESERVED_HEADERS.includes(key.toLowerCase())
    )
  )
}

/**
 * @param {Service} service
 * @param {object} [callerHeaders]
 * @returns {Promise<object>} correlation, then caller headers, with the
 *   service token and API key taking precedence
 */
export async function buildHeaders(
  { serviceName, apiKey },
  callerHeaders = {}
) {
  let token

  try {
    token = await getServiceToken(serviceName)
  } catch (cause) {
    throw new ServiceTokenError(
      `Failed to get a service token for ${serviceName}`,
      { cause }
    )
  }

  return {
    ...requestContext.getHeaders(),
    ...withoutReserved(callerHeaders),
    authorization: `Bearer ${token}`,
    ...(apiKey && { 'x-api-key': apiKey })
  }
}
