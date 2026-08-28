import h2o2 from '@hapi/h2o2'

import { getModulesForHub } from '@defra/lis-hubs-infra-registry'

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
          let host, protocol

          switch (environment) {
            case 'local':
              host = 'localhost'
              protocol = 'http'
              break
            case 'docker_compose':
              host = moduleName
              protocol = 'http'
              break
            case 'dev':
            case 'test':
            case 'perf-test':
            case 'prod':
              host = `lis-apps-${moduleName}.${environment}.cdp-int.defra.cloud`
              protocol = 'https'
              break
            default:
              throw new Error(`Unhandled environment: ${environment}`)
          }

          let baseUri = `${protocol}://${host}`

          if (environment === 'local' || environment === 'docker_compose') {
            baseUri = `${baseUri}:${port}`
          }

          server.route({
            method: '*',
            path: `${path}/{path*}`,
            handler: {
              proxy: {
                passThrough: true,
                xforward: true,
                mapUri(request) {
                  const subPath = request.params.path ?? ''
                  const uri = subPath ? `${baseUri}/${subPath}` : baseUri

                  return {
                    uri,
                    headers: {
                      'x-forwarded-prefix': path,
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
