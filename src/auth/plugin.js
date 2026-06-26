import {
  clearHubAuthSession,
  getHubAuthSession,
  setHubAuthSession
} from './session.js'
import {
  getHubJwtCookieOptions,
  getReturnUrlFromRequest,
  issueHubJwt
} from '@livestock/infrastructure/auth'

function createLoginController({
  getCookieOptions,
  getHubJwtConfig,
  getHubJwtCookieName,
  providerId,
  buildAuthorizationUrl
}) {
  return {
    options: {
      auth: false
    },
    async handler(request, h) {
      const authSession = getHubAuthSession(request)
      const returnUrl = getReturnUrlFromRequest(request)

      if (authSession) {
        const jwt = await issueHubJwt(authSession, getHubJwtConfig())

        return h
          .redirect(returnUrl)
          .state(getHubJwtCookieName(), jwt, getCookieOptions())
      }

      const resolvedProviderId =
        typeof providerId === 'function' ? providerId() : providerId
      let authorizationUrl

      try {
        authorizationUrl = await buildAuthorizationUrl(
          request,
          resolvedProviderId
        )
      } catch (error) {
        request.logger?.error?.(error)

        return h
          .response(
            'Authentication is not available. Check the hub OIDC configuration.'
          )
          .code(503)
      }

      return h.redirect(authorizationUrl)
    }
  }
}

function createCallbackController({
  getCookieOptions,
  getHubJwtConfig,
  getHubJwtCookieName,
  completeAuthorizationCodeGrant,
  fetchUserProfile
}) {
  return {
    options: {
      auth: false
    },
    async handler(request, h) {
      if (request.query?.error) {
        throw new Error(request.query?.error_description ?? request.query.error)
      }

      const { user, authSession, accessToken, returnUrl } =
        await completeAuthorizationCodeGrant(request)
      const profile = await fetchUserProfile(user, accessToken)
      const enrichedAuthSession = {
        ...authSession,
        ...profile
      }
      const jwt = await issueHubJwt(enrichedAuthSession, getHubJwtConfig())

      setHubAuthSession(request, enrichedAuthSession)

      return h
        .redirect(returnUrl)
        .state(getHubJwtCookieName(), jwt, getCookieOptions())
    }
  }
}

function createLogoutController({
  getCookieOptions,
  getHubJwtCookieName,
  buildLogoutUrl
}) {
  return {
    options: {
      auth: false
    },
    async handler(request, h) {
      const logoutUrl = await buildLogoutUrl(request)

      clearHubAuthSession(request)

      return h
        .redirect(logoutUrl)
        .unstate(getHubJwtCookieName(), getCookieOptions())
    }
  }
}

export function createHubCookieOptions({
  ttlSeconds,
  isSecure
}) {
  return getHubJwtCookieOptions({
    ttlSeconds,
    isSecure
  })
}

export function createHubAuthPlugin({
  pluginName = 'auth',
  getHubJwtCookieName,
  getCookieOptions,
  getHubJwtConfig,
  fetchUserProfile,
  buildAuthorizationUrl,
  completeAuthorizationCodeGrant,
  buildLogoutUrl,
  loginRoutes
}) {
  const callbackController = createCallbackController({
    getCookieOptions,
    getHubJwtConfig,
    getHubJwtCookieName,
    completeAuthorizationCodeGrant,
    fetchUserProfile
  })
  const logoutController = createLogoutController({
    getCookieOptions,
    getHubJwtCookieName,
    buildLogoutUrl
  })

  return {
    plugin: {
      name: pluginName,
      register(server) {
        server.state(getHubJwtCookieName(), getCookieOptions())
        server.ext('onPreAuth', (request, h) => {
          request.app.hubAuth = getHubAuthSession(request)

          return h.continue
        })

        server.route([
          ...loginRoutes.map(({ path, providerId }) => ({
            method: 'GET',
            path,
            ...createLoginController({
              getCookieOptions,
              getHubJwtConfig,
              getHubJwtCookieName,
              providerId,
              buildAuthorizationUrl
            })
          })),
          {
            method: 'GET',
            path: '/sso',
            ...callbackController
          },
          {
            method: 'GET',
            path: '/auth/logout',
            ...logoutController
          }
        ])
      }
    }
  }
}
