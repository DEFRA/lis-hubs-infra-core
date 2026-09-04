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
          let baseUri = ''

          if (isLocal(environment)) {
            baseUri = `http://localhost:${port}`
          }
          if (isCompose(environment)) {
            baseUri = `http://${moduleName}:${port}`
          }
          if (isCdp(environment)) {
            baseUri = `https://lis-apps-${moduleName}.${environment}.cdp-int.defra.cloud`
          }

          if (!isSupportedEnv(environment) || baseUri === '') {
            throw new Error(`Unsupported environment: ${environment}`)
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

function isSupportedEnv(env) {
  const envs = [
    'local',
    'docker_compose',
    'dev',
    'test',
    'ext-test',
    'perf-test',
    'prod'
  ]
  return envs.includes(env)
}

function isLocal(env) {
  return env === 'local'
}

function isCompose(env) {
  return env === 'docker_compose'
}

function isCdp(env) {
  const envs = ['dev', 'test', 'ext-test', 'perf-test', 'prod']
  return envs.includes(env)
}
