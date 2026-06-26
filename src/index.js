export const HUB_TYPES = ['front-office', 'back-office']

export const HUB_CORE_STATUS = 'scaffolded'

export {
  clearHubAuthFlow,
  clearHubAuthSession,
  createHubAuthFlow,
  getHubAuthFlow,
  getHubAuthSession,
  setHubAuthFlow,
  setHubAuthSession
} from './auth/session.js'

export { createOidcClient } from './auth/oidc.js'
export { createHubAuthPlugin, createHubCookieOptions } from './auth/plugin.js'
