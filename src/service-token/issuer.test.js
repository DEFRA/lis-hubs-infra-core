import { STSClient } from '@aws-sdk/client-sts'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@aws-sdk/client-sts', async (importOriginal) => ({
  ...(await importOriginal()),
  STSClient: vi.fn()
}))

const NOW = new Date('2026-01-01T00:00:00Z')

function tokenResponse(token, secondsFromNow = 900) {
  return {
    WebIdentityToken: token,
    Expiration: new Date(NOW.getTime() + secondsFromNow * 1000)
  }
}

describe('getServiceToken()', () => {
  let send
  let getServiceToken

  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    send = vi.fn()
    vi.mocked(STSClient).mockImplementation(function () {
      this.send = send
    })
    ;({ getServiceToken } = await import('./issuer.js'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  test('builds one STS client, with request timeouts and limited attempts', async () => {
    // Arrange
    send.mockResolvedValue(tokenResponse('t1'))

    // Act
    await getServiceToken('aud-a')
    await getServiceToken('aud-b')

    // Assert
    expect(STSClient).toHaveBeenCalledTimes(1)
    expect(STSClient).toHaveBeenCalledWith({
      requestHandler: { connectionTimeout: 2000, requestTimeout: 3000 },
      maxAttempts: 2
    })
  })

  test('requests a token for the audience with fixed options and no tags', async () => {
    // Arrange
    send.mockResolvedValueOnce(tokenResponse('t1'))

    // Act
    let result, error
    try {
      result = await getServiceToken('lis-apps-cattle-home')
    } catch (e) {
      error = e
    }

    // Assert
    expect(error).toBeUndefined()
    expect(result).toBe('t1')
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].input).toEqual({
      Audience: ['lis-apps-cattle-home'],
      DurationSeconds: 900,
      SigningAlgorithm: 'RS256'
    })
  })

  test('reuses the cached token before the refresh window', async () => {
    // Arrange
    send.mockResolvedValueOnce(tokenResponse('t1'))
    await getServiceToken('aud')
    vi.setSystemTime(new Date(NOW.getTime() + 839 * 1000))

    // Act
    const result = await getServiceToken('aud')

    // Assert
    expect(result).toBe('t1')
    expect(send).toHaveBeenCalledTimes(1)
  })

  test('returns the cached token inside the refresh window and refreshes in the background', async () => {
    // Arrange
    send
      .mockResolvedValueOnce(tokenResponse('t1'))
      .mockReturnValueOnce(new Promise(() => undefined))
    await getServiceToken('aud')
    vi.setSystemTime(new Date(NOW.getTime() + 840 * 1000))

    // Act
    const result = await getServiceToken('aud')

    // Assert
    expect(result).toBe('t1')
    expect(send).toHaveBeenCalledTimes(2)
  })

  test('triggers a single background refresh for concurrent calls inside the window', async () => {
    // Arrange
    send
      .mockResolvedValueOnce(tokenResponse('t1'))
      .mockReturnValueOnce(new Promise(() => undefined))
    await getServiceToken('aud')
    vi.setSystemTime(new Date(NOW.getTime() + 840 * 1000))

    // Act
    const results = await Promise.all([
      getServiceToken('aud'),
      getServiceToken('aud')
    ])

    // Assert
    expect(results).toEqual(['t1', 't1'])
    expect(send).toHaveBeenCalledTimes(2)
  })

  test('returns the new token on the call after a successful background refresh', async () => {
    // Arrange
    send
      .mockResolvedValueOnce(tokenResponse('t1'))
      .mockResolvedValueOnce(tokenResponse('t2', 1800))
    await getServiceToken('aud')
    vi.setSystemTime(new Date(NOW.getTime() + 840 * 1000))
    await getServiceToken('aud')
    await vi.advanceTimersByTimeAsync(0)

    // Act
    const result = await getServiceToken('aud')

    // Assert
    expect(result).toBe('t2')
    expect(send).toHaveBeenCalledTimes(2)
  })

  test('keeps serving the cached token when a background refresh fails and retries on the next call', async () => {
    // Arrange
    send
      .mockResolvedValueOnce(tokenResponse('t1'))
      .mockRejectedValueOnce(new Error('sts down'))
      .mockResolvedValueOnce(tokenResponse('t2', 1800))
    await getServiceToken('aud')
    vi.setSystemTime(new Date(NOW.getTime() + 840 * 1000))
    const duringFailure = await getServiceToken('aud')
    await vi.advanceTimersByTimeAsync(0)

    // Act
    const afterFailure = await getServiceToken('aud')
    await vi.advanceTimersByTimeAsync(0)
    const afterRetry = await getServiceToken('aud')

    // Assert
    expect(duringFailure).toBe('t1')
    expect(afterFailure).toBe('t1')
    expect(afterRetry).toBe('t2')
    expect(send).toHaveBeenCalledTimes(3)
  })

  test('caches tokens separately per audience', async () => {
    // Arrange
    send
      .mockResolvedValueOnce(tokenResponse('token-a'))
      .mockResolvedValueOnce(tokenResponse('token-b'))

    // Act
    const first = await getServiceToken('aud-a')
    const second = await getServiceToken('aud-b')
    const firstAgain = await getServiceToken('aud-a')

    // Assert
    expect(first).toBe('token-a')
    expect(second).toBe('token-b')
    expect(firstAgain).toBe('token-a')
    expect(send).toHaveBeenCalledTimes(2)
  })

  test('shares one in-flight request between concurrent calls for an audience', async () => {
    // Arrange
    send.mockResolvedValueOnce(tokenResponse('t1'))

    // Act
    const results = await Promise.all([
      getServiceToken('aud'),
      getServiceToken('aud')
    ])

    // Assert
    expect(results).toEqual(['t1', 't1'])
    expect(send).toHaveBeenCalledTimes(1)
  })

  test('does not cache a failed request so the next call retries', async () => {
    // Arrange
    send
      .mockRejectedValueOnce(new Error('sts down'))
      .mockResolvedValueOnce(tokenResponse('t1'))

    // Act
    let firstError
    try {
      await getServiceToken('aud')
    } catch (e) {
      firstError = e
    }
    const result = await getServiceToken('aud')

    // Assert
    expect(firstError.message).toBe('sts down')
    expect(result).toBe('t1')
    expect(send).toHaveBeenCalledTimes(2)
  })

  test('rejects when the refresh of an expired token fails', async () => {
    // Arrange
    send
      .mockResolvedValueOnce(tokenResponse('t1'))
      .mockRejectedValueOnce(new Error('sts down'))
    await getServiceToken('aud')
    vi.setSystemTime(new Date(NOW.getTime() + 900 * 1000))

    // Act
    let error
    try {
      await getServiceToken('aud')
    } catch (e) {
      error = e
    }

    // Assert
    expect(error.message).toBe('sts down')
  })

  test('throws when the response has an invalid Expiration', async () => {
    // Arrange
    send.mockResolvedValueOnce({
      WebIdentityToken: 't1',
      Expiration: 'not a date'
    })

    // Act
    let error
    try {
      await getServiceToken('aud')
    } catch (e) {
      error = e
    }

    // Assert
    expect(error.message).toBe(
      'STS response did not include a valid Expiration'
    )
  })

  test.each([[{}], [undefined]])(
    'throws when the response has no WebIdentityToken (%j)',
    async (response) => {
      // Arrange
      send.mockResolvedValueOnce(response)

      // Act
      let error
      try {
        await getServiceToken('aud')
      } catch (e) {
        error = e
      }

      // Assert
      expect(error.message).toBe(
        'STS response did not include a WebIdentityToken'
      )
    }
  )
})
