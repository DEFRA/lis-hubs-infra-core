import * as requestContext from '../request-context.js'

/**
 * pino mixin() - merges request-scoped context (correlation_id, user_id,
 * origin_service, cph, animal_id) from the current AsyncLocalStorage store
 * into every log line, mapped onto ECS's tenant.id/tenant.message fields.
 * @returns {object}
 */
export function mixin() {
  const mixinValues = {}
  const correlationId = requestContext.get('correlation_id')

  if (correlationId) {
    mixinValues.trace = { id: correlationId }
  }

  const userId = requestContext.get('user_id')
  if (userId) {
    mixinValues.tenant = { id: userId }
  }

  const tenantMessage = ['origin_service', 'cph', 'animal_id']
    .map((key) => [key, requestContext.get(key)])
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ')

  if (tenantMessage) {
    mixinValues.tenant = { ...mixinValues.tenant, message: tenantMessage }
  }

  return mixinValues
}
