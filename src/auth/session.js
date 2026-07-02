import crypto from 'node:crypto'

const authFlowKey = 'hub-auth-flow'
const authSessionKey = 'hub-auth-session'

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

export function getHubAuthFlow(request) {
  return request?.yar?.get ? (request.yar.get(authFlowKey) ?? null) : null
}

export function setHubAuthFlow(request, authFlow) {
  request?.yar?.set?.(authFlowKey, authFlow)
}

export function clearHubAuthFlow(request) {
  request?.yar?.clear?.(authFlowKey)
}

export function getHubAuthSession(request) {
  return request?.yar?.get ? (request.yar.get(authSessionKey) ?? null) : null
}

export function setHubAuthSession(request, authSession) {
  request?.yar?.set?.(authSessionKey, authSession)
}

export function clearHubAuthSession(request) {
  request.yar.clear(authSessionKey)
  clearHubAuthFlow(request)
}
