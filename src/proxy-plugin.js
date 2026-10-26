import Boom from '@hapi/boom'
import h2o2 from '@hapi/h2o2'

import { getModulesForHub } from '@defra/lis-hubs-infra-registry'
import { getServiceBaseUrl } from './get-service-base-url.js'
import { getServiceToken } from './service-token/issuer.js'
import { ServiceTokenError } from './base-client.js'

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
 * @param {string} serviceName
 * @returns {Promise<string>} a service token for the spoke
 * @throws {ServiceTokenError} naming the spoke, so the hub's error log says which one
 */
async function getSpokeServiceToken(serviceName) {
  try {
    return await getServiceToken(serviceName)
  } catch (err) {
    throw new ServiceTokenError(
      `Service token unavailable for spoke ${serviceName}`,
      { cause: err }
    )
  }
}

/**
 * h2o2 onResponse. An upstream failure becomes a Boom error naming the spoke,
 * keeping the upstream status, so the hub's error handler logs it once with
 * that context, while the response body stays generic. A response is passed
 * through as h2o2 does by default.
 *
 * @param {string} serviceName
 * @returns {Function} an h2o2 onResponse handler
 */
function wrapSpokeFailure(serviceName) {
  return function onResponse(err, res, _request, h) {
    if (err) {
      const wrapped = new Error(
        `Spoke ${serviceName} request failed: ${err.message}`,
        { cause: err }
      )
      const boom = Boom.boomify(wrapped, {
        statusCode: err.output?.statusCode ?? BAD_GATEWAY
      })
      // Boom only hides the message of a 500; this one names the spoke and
      // the upstream address, which the browser must not see.
      boom.output.payload.message = GENERIC_ERROR_MESSAGE
      return boom
    }
    return h.response(res).code(res.statusCode).passThrough(true)
  }
}

/**
 * @param {object} options
 * @param {string} options.hubId
 * @param {string} options.environment
 * @param {string} options.hubJwtCookieName - the cookie that identifies the user to the spoke
 * @param {string[]} [options.forwardedCookieNames] - other browser cookies the spoke may see, such as the cookie consent choice; none by default
 * @returns {{ plugin: { name: string, register: Function } }}
 */
export function createProxyPlugin({
  hubId,
  environment,
  hubJwtCookieName,
  forwardedCookieNames = []
}) {
  if (!hubJwtCookieName) {
    throw new Error('hubJwtCookieName is required')
  }
  if (
    !Array.isArray(forwardedCookieNames) ||
    forwardedCookieNames.some((name) => typeof name !== 'string' || !name)
  ) {
    throw new Error('forwardedCookieNames must be an array of cookie names')
  }

  const cookieNames = [hubJwtCookieName, ...forwardedCookieNames]

  const modules = getModulesForHub(hubId).toSorted(
    (a, b) => b.path.split('/').length - a.path.split('/').length
  )

  return {
    plugin: {
      name: 'proxy',
      async register(server) {
        await server.register(h2o2)

        for (const { id: moduleName, path, port } of modules) {
          const serviceName = `lis-apps-${moduleName}`
          const baseUri = getServiceBaseUrl(
            environment,
            serviceName,
            port
          ).origin

          server.route({
            method: '*',
            path: `${path}/{path*}`,
            handler: {
              proxy: {
                passThrough: true,
                xforward: true,
                onResponse: wrapSpokeFailure(serviceName),
                async mapUri(request) {
                  const subPath = request.params.path ?? ''
                  const uri =
                    (subPath ? `${baseUri}/${subPath}` : baseUri) +
                    request.url.search

                  // passThrough copies request.headers itself and merges these
                  // headers on top, so a header can only be withheld from the
                  // spoke by removing it from the request. The spoke only gets
                  // the hub JWT cookie and the cookies named as forwarded,
                  // never the hub's session or credentials.
                  const forwardedCookies = pickCookies(
                    request.headers.cookie,
                    cookieNames
                  )
                  delete request.headers.authorization
                  delete request.headers.cookie

                  return {
                    uri,
                    headers: {
                      'x-forwarded-prefix': path,
                      authorization: `Bearer ${await getSpokeServiceToken(serviceName)}`,
                      ...(forwardedCookies && { cookie: forwardedCookies })
                    }
                  }
                }
              }
            }
          })
        }
      }
    }
  }
}
