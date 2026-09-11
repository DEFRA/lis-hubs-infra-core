/**
 * Resolves the base URL for a service, depending on where this process is
 * running. On `docker_compose`, this reaches the service via the host
 * machine's network stack (host.docker.internal), so it only works if the
 * service's port is published to the host - which every service in this
 * project's compose files is.
 *
 * @param {string} environment 'local' | 'docker_compose' | 'dev' | 'test' | 'ext-test' | 'perf-test' | 'prod'
 * @param {string} serviceName the service's repo name, e.g. 'lis-apps-cattle-home'
 * @param {number} [localPort] the port the service listens on locally - required for 'local' and 'docker_compose'
 * @returns {URL} the service's base URL
 */
export const getServiceBaseUrl = (environment, serviceName, localPort) => {
  let base

  switch (environment) {
    case 'local':
      base = `http://localhost:${requireLocalPort(localPort, environment)}`
      break
    case 'docker_compose':
      base = `http://host.docker.internal:${requireLocalPort(localPort, environment)}`
      break
    case 'dev':
    case 'test':
    case 'ext-test':
    case 'perf-test':
    case 'prod':
      base = `https://${serviceName}.${environment}.cdp-int.defra.cloud`
      break
    default:
      throw new Error(`Unsupported environment: ${environment}`)
  }

  return new URL(base)
}

function requireLocalPort(localPort, environment) {
  if (!localPort) {
    throw new Error(
      `getServiceBaseUrl requires a localPort for the ${environment} environment`
    )
  }

  return localPort
}
