import h2o2 from '@hapi/h2o2'

import { getModulesForHub } from '@defra/lis-hubs-infra-registry'
import * as requestContext from './request-context.js'

const lisContextHeaderNames = [
  'x-lis-origin-service',
  'x-lis-cph-number',
  'x-lis-animal-id',
  'x-lis-user-id'
]

/**
 * h2o2's passThrough clones the client's original request headers before
 * merging this object on top (Hoek.merge, which skips null/undefined to
 * preserve empty strings) - so every x-lis-* header must be set explicitly,
 * blanking any without a trusted value, or an attacker-supplied header on
 * the original request would pass through to the spoke untouched.
 * @param {string} hubId
 * @returns {object}
 */
function buildLisContextHeaders(hubId) {
  const headers = Object.fromEntries(
    lisContextHeaderNames.map((header) => [header, ''])
  )

  Object.assign(headers, requestContext.getHeaders())

  if (!headers['x-lis-origin-service']) {
    headers['x-lis-origin-service'] = hubId
  }

  return headers
}

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
                      }),
                      ...buildLisContextHeaders(hubId)
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
