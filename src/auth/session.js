/** @import { Request } from '@hapi/hapi' */
import crypto from 'node:crypto'

const authFlowKey = 'hub-auth-flow'
const authSessionKey = 'hub-auth-session'

/**
 * @param {{ returnUrl: string, generateId?: Function }} options
 * @returns {{ state: string, nonce: string, returnUrl: string }}
 */
export function createHubAuthFlow({
  returnUrl,
  generateId = crypto.randomUUID
}) {
  return {
    state: generateId(),
    nonce: generateId(),
    returnUrl
  }
}

/**
 * @param {Request} request
 * @returns {object | null}
 */
export function getHubAuthFlow(request) {
  return request?.yar?.get ? (request.yar.get(authFlowKey) ?? null) : null
}

/**
 * @param {Request} request
 * @param {object} authFlow
 * @returns {void}
 */
export function setHubAuthFlow(request, authFlow) {
  request?.yar?.set?.(authFlowKey, authFlow)
}

/**
 * @param {Request} request
 * @returns {void}
 */
export function clearHubAuthFlow(request) {
  request?.yar?.clear?.(authFlowKey)
}

/**
 * @param {Request} request
 * @returns {object | null}
 */
export function getHubAuthSession(request) {
  return request?.yar?.get ? (request.yar.get(authSessionKey) ?? null) : null
}

/**
 * @param {Request} request
 * @param {object} authSession
 * @returns {void}
 */
export function setHubAuthSession(request, authSession) {
  request?.yar?.set?.(authSessionKey, authSession)
}

/**
 * @param {Request} request
 * @returns {void}
 */
export function clearHubAuthSession(request) {
  request.yar.clear(authSessionKey)
  clearHubAuthFlow(request)
}
