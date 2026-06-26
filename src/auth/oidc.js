import { createRemoteJWKSet, jwtVerify } from 'jose'
import {
  clearHubAuthFlow,
  createHubAuthFlow,
  getHubAuthFlow,
  getHubAuthSession,
  setHubAuthFlow
} from './session.js'

import {
  getReturnUrlFromRequest,
  sanitizeReturnUrl
} from '@livestock/infrastructure/auth'

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options)

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`)
  }

  return response.json()
}

export function createOidcClient({
  getProviderConfig,
  getHubOrigin,
  getPrimaryProviderId,
  mapUser
}) {
  const providerMetadata = new Map()
  const providerJwks = new Map()

  function resolveProviderId(providerId) {
    const resolvedProviderId = providerId ?? getPrimaryProviderId?.()

    if (!resolvedProviderId) {
      throw new Error('Authentication provider id is required')
    }

    return resolvedProviderId
  }

  function resolveProviderConfig(providerId) {
    const resolvedProviderId = resolveProviderId(providerId)
    const providerConfig = getProviderConfig(resolvedProviderId)

    if (!providerConfig?.discoveryUrl) {
      throw new Error(
        `OIDC discovery URL is not configured for provider ${resolvedProviderId}`
      )
    }

    return {
      providerId: resolvedProviderId,
      ...providerConfig
    }
  }

  function getRedirectUri(providerId) {
    const providerConfig = resolveProviderConfig(providerId)

    return new URL(providerConfig.redirectPath, getHubOrigin()).toString()
  }

  async function getOidcMetadata(providerId) {
    const providerConfig = resolveProviderConfig(providerId)

    if (!providerMetadata.has(providerConfig.providerId)) {
      providerMetadata.set(
        providerConfig.providerId,
        fetchJson(providerConfig.discoveryUrl)
      )
    }

    return providerMetadata.get(providerConfig.providerId)
  }

  async function exchangeCodeForTokens(providerId, code) {
    const providerConfig = resolveProviderConfig(providerId)
    const metadata = await getOidcMetadata(providerConfig.providerId)
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: getRedirectUri(providerConfig.providerId),
      client_id: providerConfig.clientId,
      client_secret: providerConfig.clientSecret
    })

    if (providerConfig.serviceId) {
      body.set('serviceId', providerConfig.serviceId)
    }

    return fetchJson(metadata.token_endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body
    })
  }

  async function buildAuthorizationUrl(request, providerId) {
    const providerConfig = resolveProviderConfig(providerId)
    const metadata = await getOidcMetadata(providerConfig.providerId)
    const returnUrl = getReturnUrlFromRequest(request)
    const authFlow = {
      ...createHubAuthFlow({ returnUrl }),
      providerId: providerConfig.providerId
    }

    setHubAuthFlow(request, authFlow)

    const authorizationUrl = new URL(metadata.authorization_endpoint)
    authorizationUrl.searchParams.set('client_id', providerConfig.clientId)
    authorizationUrl.searchParams.set('response_type', 'code')
    authorizationUrl.searchParams.set('scope', 'openid')
    authorizationUrl.searchParams.set(
      'redirect_uri',
      getRedirectUri(providerConfig.providerId)
    )
    authorizationUrl.searchParams.set('state', authFlow.state)
    authorizationUrl.searchParams.set('nonce', authFlow.nonce)

    if (providerConfig.serviceId) {
      authorizationUrl.searchParams.set('serviceId', providerConfig.serviceId)
    }

    return authorizationUrl.toString()
  }

  async function completeAuthorizationCodeGrant(request) {
    const authFlow = getHubAuthFlow(request)
    const providerId = authFlow?.providerId ?? getPrimaryProviderId?.()

    if (!authFlow?.state || !authFlow?.nonce || !providerId) {
      throw new Error('Authentication flow session was not found')
    }

    if (request.query?.state !== authFlow.state) {
      throw new Error('State mismatch')
    }

    if (!request.query?.code) {
      throw new Error('Authorization code was not returned')
    }

    const providerConfig = resolveProviderConfig(providerId)
    const metadata = await getOidcMetadata(providerConfig.providerId)
    const tokens = await exchangeCodeForTokens(
      providerConfig.providerId,
      request.query.code
    )

    if (!tokens.id_token) {
      throw new Error('Token response did not include an ID token')
    }

    if (!providerJwks.has(providerConfig.providerId)) {
      providerJwks.set(
        providerConfig.providerId,
        createRemoteJWKSet(new URL(metadata.jwks_uri))
      )
    }

    const { payload } = await jwtVerify(
      tokens.id_token,
      providerJwks.get(providerConfig.providerId),
      {
        issuer: metadata.issuer,
        audience: providerConfig.clientId
      }
    )

    if (payload.nonce !== authFlow.nonce) {
      throw new Error('Nonce mismatch')
    }

    if (
      providerConfig.serviceId &&
      payload.serviceId &&
      payload.serviceId !== providerConfig.serviceId
    ) {
      throw new Error('Unexpected serviceId claim')
    }

    const user = mapUser(payload, {
      providerId: providerConfig.providerId,
      providerConfig
    })
    const authSession = {
      ...user,
      idToken: tokens.id_token,
      authenticatedAt: new Date().toISOString()
    }

    clearHubAuthFlow(request)

    return {
      user,
      authSession,
      accessToken: tokens.access_token ?? null,
      providerId: providerConfig.providerId,
      returnUrl: sanitizeReturnUrl(authFlow.returnUrl)
    }
  }

  async function buildLogoutUrl(request) {
    const authSession = getHubAuthSession(request)
    const providerId = authSession?.authProvider ?? getPrimaryProviderId?.()
    const metadata = await getOidcMetadata(providerId)
    const logoutUrl = new URL(metadata.end_session_endpoint)

    logoutUrl.searchParams.set('post_logout_redirect_uri', getHubOrigin())

    if (authSession?.idToken) {
      logoutUrl.searchParams.set('id_token_hint', authSession.idToken)
    }

    return logoutUrl.toString()
  }

  return {
    buildAuthorizationUrl,
    buildLogoutUrl,
    completeAuthorizationCodeGrant,
    getOidcMetadata
  }
}
