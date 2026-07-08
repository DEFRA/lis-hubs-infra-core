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
} from '@livestock/ui-services/auth'

class OidcClient {
  #getProviderConfig
  #getHubOrigin
  #getPrimaryProviderId
  #mapUser
  #providerMetadata = new Map()
  #providerJwks = new Map()

  constructor({ getProviderConfig, getHubOrigin, getPrimaryProviderId, mapUser }) {
    this.#getProviderConfig = getProviderConfig
    this.#getHubOrigin = getHubOrigin
    this.#getPrimaryProviderId = getPrimaryProviderId
    this.#mapUser = mapUser
  }

  async #fetchJson(url, options = {}) {
    const response = await fetch(url, options)

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`)
    }

    return response.json()
  }

  #validateAuthorizationFlow(authFlow, providerId, request) {
    if (!authFlow?.state || !authFlow?.nonce || !providerId) {
      throw new Error('Authentication flow session was not found')
    }

    if (request.query?.state !== authFlow.state) {
      throw new Error('State mismatch')
    }

    if (!request.query?.code) {
      throw new Error('Authorization code was not returned')
    }
  }

  #validateIdTokenClaims(payload, authFlow, providerConfig) {
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
  }

  #resolveProviderId(providerId) {
    const resolvedProviderId = providerId ?? this.#getPrimaryProviderId?.()

    if (!resolvedProviderId) {
      throw new Error('Authentication provider id is required')
    }

    return resolvedProviderId
  }

  #resolveProviderConfig(providerId) {
    const resolvedProviderId = this.#resolveProviderId(providerId)
    const providerConfig = this.#getProviderConfig(resolvedProviderId)

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

  #getRedirectUri(providerId) {
    const providerConfig = this.#resolveProviderConfig(providerId)

    return new URL(
      providerConfig.redirectPath,
      this.#getHubOrigin()
    ).toString()
  }

  async getOidcMetadata(providerId) {
    const providerConfig = this.#resolveProviderConfig(providerId)

    if (!this.#providerMetadata.has(providerConfig.providerId)) {
      this.#providerMetadata.set(
        providerConfig.providerId,
        this.#fetchJson(providerConfig.discoveryUrl)
      )
    }

    return this.#providerMetadata.get(providerConfig.providerId)
  }

  async #exchangeCodeForTokens(providerId, code) {
    const providerConfig = this.#resolveProviderConfig(providerId)
    const metadata = await this.getOidcMetadata(providerConfig.providerId)
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.#getRedirectUri(providerConfig.providerId),
      client_id: providerConfig.clientId,
      client_secret: providerConfig.clientSecret
    })

    if (providerConfig.serviceId) {
      body.set('serviceId', providerConfig.serviceId)
    }

    return this.#fetchJson(metadata.token_endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body
    })
  }

  async buildAuthorizationUrl(request, providerId) {
    const providerConfig = this.#resolveProviderConfig(providerId)
    const metadata = await this.getOidcMetadata(providerConfig.providerId)
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
      this.#getRedirectUri(providerConfig.providerId)
    )
    authorizationUrl.searchParams.set('state', authFlow.state)
    authorizationUrl.searchParams.set('nonce', authFlow.nonce)

    if (providerConfig.serviceId) {
      authorizationUrl.searchParams.set('serviceId', providerConfig.serviceId)
    }

    return authorizationUrl.toString()
  }

  async #verifyIdToken(tokens, metadata, providerConfig) {
    if (!tokens.id_token) {
      throw new Error('Token response did not include an ID token')
    }

    if (!this.#providerJwks.has(providerConfig.providerId)) {
      this.#providerJwks.set(
        providerConfig.providerId,
        createRemoteJWKSet(new URL(metadata.jwks_uri))
      )
    }

    const { payload } = await jwtVerify(
      tokens.id_token,
      this.#providerJwks.get(providerConfig.providerId),
      {
        issuer: metadata.issuer,
        audience: providerConfig.clientId
      }
    )

    return payload
  }

  async completeAuthorizationCodeGrant(request) {
    const authFlow = getHubAuthFlow(request)
    const providerId = authFlow?.providerId ?? this.#getPrimaryProviderId?.()

    this.#validateAuthorizationFlow(authFlow, providerId, request)

    const providerConfig = this.#resolveProviderConfig(providerId)
    const metadata = await this.getOidcMetadata(providerConfig.providerId)
    const tokens = await this.#exchangeCodeForTokens(
      providerConfig.providerId,
      request.query.code
    )
    const payload = await this.#verifyIdToken(tokens, metadata, providerConfig)

    this.#validateIdTokenClaims(payload, authFlow, providerConfig)

    const user = this.#mapUser(payload, {
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

  async buildLogoutUrl(request) {
    const authSession = getHubAuthSession(request)
    const providerId =
      authSession?.authProvider ?? this.#getPrimaryProviderId?.()
    const metadata = await this.getOidcMetadata(providerId)
    const logoutUrl = new URL(metadata.end_session_endpoint)

    logoutUrl.searchParams.set('post_logout_redirect_uri', this.#getHubOrigin())

    if (authSession?.idToken) {
      logoutUrl.searchParams.set('id_token_hint', authSession.idToken)
    }

    return logoutUrl.toString()
  }
}

/**
 * @param {{ getProviderConfig: Function, getHubOrigin: Function, getPrimaryProviderId?: Function, mapUser: Function }} options
 * @returns {OidcClient}
 */
export function createOidcClient(options) {
  return new OidcClient(options)
}
