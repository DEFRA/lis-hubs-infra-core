import h2o2 from '@hapi/h2o2'

import { getModulesForHub } from '@defra/lis-hubs-infra-registry'
import { getServiceBaseUrl } from './get-service-base-url.js'

/**
 * @param {{ hubId: string, environment: string }} options
 * @returns {{ plugin: { name: string, register: Function } }}
 */
export function createProxyPlugin({ hubId, environment }) {
  const modules = getModulesForHub(hubId).toSorted(
    (a, b) => b.path.split('/').length - a.path.split('/').length
  )

  return {
    plugin: {
      name: 'proxy',
      async register(server) {
        await server.register(h2o2)

        for (const { id: moduleName, path, port } of modules) {
          const baseUri = getServiceBaseUrl(
            environment,
            `lis-apps-${moduleName}`,
            port
          ).origin

          server.route({
            method: '*',
            path: `${path}/{path*}`,
            handler: {
              proxy: {
                passThrough: true,
                xforward: true,
                mapUri(request) {
                  const subPath = request.params.path ?? ''
                  const uri =
                    (subPath ? `${baseUri}/${subPath}` : baseUri) +
                    request.url.search

                  return {
                    uri,
                    headers: {
                      'x-forwarded-prefix': path,
                      ...(request.headers.authorization && {
                        authorization: request.headers.authorization
                      }),
                      ...(request.headers.cookie && {
                        cookie: request.headers.cookie
                      })
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
