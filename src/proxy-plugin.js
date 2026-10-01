import h2o2 from '@hapi/h2o2'

import { getModulesForHub } from '@defra/lis-hubs-infra-registry'
import { getServiceBaseUrl } from './get-service-base-url.js'
import { getServiceToken } from './service-token/issuer.js'

/**
 * @param {string | undefined} cookieHeader
 * @param {string} name
 * @returns {string | undefined} the raw `name=value` pair, encoding untouched
 */
function findCookie(cookieHeader, name) {
  return cookieHeader
    ?.split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`))
}

/**
 * @param {{ hubId: string, environment: string, hubJwtCookieName: string }} options
 * @returns {{ plugin: { name: string, register: Function } }}
 */
export function createProxyPlugin({ hubId, environment, hubJwtCookieName }) {
  if (!hubJwtCookieName) {
    throw new Error('hubJwtCookieName is required')
  }

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
                async mapUri(request) {
                  const subPath = request.params.path ?? ''
                  const uri =
                    (subPath ? `${baseUri}/${subPath}` : baseUri) +
                    request.url.search

                  // passThrough copies request.headers itself and merges these
                  // headers on top, so a header can only be withheld from the
                  // spoke by removing it from the request. The spoke only gets
                  // the hub JWT cookie, never the hub's session or credentials.
                  const hubJwtCookie = findCookie(
                    request.headers.cookie,
                    hubJwtCookieName
                  )
                  delete request.headers.authorization
                  delete request.headers.cookie

                  return {
                    uri,
                    headers: {
                      'x-forwarded-prefix': path,
                      authorization: `Bearer ${await getServiceToken(serviceName)}`,
                      ...(hubJwtCookie && { cookie: hubJwtCookie })
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
