import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { logger } from './logging/index.js'
import {
  CIRCUIT_STATES,
  CircuitBreaker,
  CircuitOpenError
} from './circuit-breaker.js'

const logs = { warn: vi.fn(), info: vi.fn() }

beforeEach(() => {
  vi.spyOn(logger, 'warn', 'get').mockReturnValue(logs.warn)
  vi.spyOn(logger, 'info', 'get').mockReturnValue(logs.info)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

function createBreaker(options = {}) {
  const clock = { time: 1000 }
  const breaker = new CircuitBreaker({
    name: 'lis-apps-cattle-home',
    failureThreshold: 3,
    resetTimeout: 500,
    now: () => clock.time,
    ...options
  })
  return { breaker, clock }
}

describe('CircuitBreaker constructor', () => {
  test('it requires a name', () => {
    // Act
    let error
    try {
      // eslint-disable-next-line no-new
      new CircuitBreaker({})
    } catch (e) {
      error = e
    }

    // Assert
    expect(error.message).toBe('name is required')
  })

  test.each([
    ['failureThreshold', 0],
    ['failureThreshold', 1.5],
    ['resetTimeout', 0],
    ['resetTimeout', -1]
  ])('it rejects a %s of %s', (option, value) => {
    // Act
    let error
    try {
      // eslint-disable-next-line no-new
      new CircuitBreaker({ name: 'spoke', [option]: value })
    } catch (e) {
      error = e
    }

    // Assert
    expect(error.message).toBe(`${option} must be a positive integer`)
  })

  test('it starts closed with the defaults', () => {
    // Act
    const breaker = new CircuitBreaker({ name: 'spoke' })

    // Assert
    expect(breaker.name).toBe('spoke')
    expect(breaker.state).toBe(CIRCUIT_STATES.CLOSED)
    expect(() => breaker.assertCallAllowed()).not.toThrow()
  })
})

describe('closed circuit', () => {
  test('it stays closed below the failure threshold', () => {
    // Arrange
    const { breaker } = createBreaker()

    // Act
    breaker.recordFailure()
    breaker.recordFailure()

    // Assert
    expect(breaker.state).toBe(CIRCUIT_STATES.CLOSED)
    expect(() => breaker.assertCallAllowed()).not.toThrow()
  })

  test('it resets the failure count on a success', () => {
    // Arrange
    const { breaker } = createBreaker()
    breaker.recordFailure()
    breaker.recordFailure()

    // Act
    breaker.recordSuccess()
    breaker.recordFailure()
    breaker.recordFailure()

    // Assert
    expect(breaker.state).toBe(CIRCUIT_STATES.CLOSED)
  })

  test('it opens, with a warning, after consecutive failures reach the threshold', () => {
    // Arrange
    const { breaker } = createBreaker()

    // Act
    breaker.recordFailure()
    breaker.recordFailure()
    breaker.recordFailure()

    // Assert
    expect(breaker.state).toBe(CIRCUIT_STATES.OPEN)
    expect(logs.warn).toHaveBeenCalledTimes(1)
    expect(logs.warn).toHaveBeenCalledWith(
      'Circuit opened for lis-apps-cattle-home after 3 consecutive transport failures; failing fast for 500ms'
    )
  })

  test('it logs nothing below the failure threshold', () => {
    // Arrange
    const { breaker } = createBreaker()

    // Act
    breaker.recordFailure()
    breaker.recordSuccess()

    // Assert
    expect(logs.warn).not.toHaveBeenCalled()
    expect(logs.info).not.toHaveBeenCalled()
  })
})

describe('open circuit', () => {
  test('it fails fast with a 503 naming the service', () => {
    // Arrange
    const { breaker } = createBreaker({ failureThreshold: 1 })
    breaker.recordFailure()

    // Act
    let error
    try {
      breaker.assertCallAllowed()
    } catch (e) {
      error = e
    }

    // Assert
    expect(error).toBeInstanceOf(CircuitOpenError)
    expect(error.name).toBe('CircuitOpenError')
    expect(error.message).toBe('Circuit open for lis-apps-cattle-home')
    expect(error.statusCode).toBe(503)
    expect(error.isBoom).toBe(true)
    expect(error.output.statusCode).toBe(503)
    expect(error.output.payload).toEqual({
      statusCode: 503,
      error: 'Service Unavailable',
      message: 'An internal server error occurred'
    })
  })

  test('it stays open until the reset timeout has passed', () => {
    // Arrange
    const { breaker, clock } = createBreaker({ failureThreshold: 1 })
    breaker.recordFailure()

    // Act
    clock.time += 499

    // Assert
    expect(breaker.state).toBe(CIRCUIT_STATES.OPEN)
    expect(() => breaker.assertCallAllowed()).toThrow(CircuitOpenError)
  })

  test('it ignores a straggling failure, so the open window is not extended', () => {
    // Arrange
    const { breaker, clock } = createBreaker({ failureThreshold: 1 })
    breaker.recordFailure()
    clock.time += 400

    // Act
    breaker.recordFailure()
    clock.time += 100

    // Assert
    expect(breaker.state).toBe(CIRCUIT_STATES.HALF_OPEN)
  })

  test('it ignores a straggling success, so only the probe can close it', () => {
    // Arrange
    const { breaker } = createBreaker({ failureThreshold: 1 })
    breaker.recordFailure()

    // Act
    breaker.recordSuccess()

    // Assert
    expect(breaker.state).toBe(CIRCUIT_STATES.OPEN)
  })

  test('it goes half-open, logging once, when the reset timeout has passed', () => {
    // Arrange
    const { breaker, clock } = createBreaker({ failureThreshold: 1 })
    breaker.recordFailure()

    // Act
    clock.time += 500
    const first = breaker.state
    const second = breaker.state

    // Assert
    expect(first).toBe(CIRCUIT_STATES.HALF_OPEN)
    expect(second).toBe(CIRCUIT_STATES.HALF_OPEN)
    expect(logs.info).toHaveBeenCalledTimes(1)
    expect(logs.info).toHaveBeenCalledWith(
      'Circuit half-open for lis-apps-cattle-home; letting one probe call through'
    )
  })
})

describe('half-open circuit', () => {
  function createHalfOpenBreaker() {
    const { breaker, clock } = createBreaker({ failureThreshold: 1 })
    breaker.recordFailure()
    clock.time += 500
    return { breaker, clock }
  }

  test('it lets one probe call through and fails the rest fast', () => {
    // Arrange
    const { breaker } = createHalfOpenBreaker()

    // Act
    const probeAllowed = (() => {
      try {
        breaker.assertCallAllowed()
        return true
      } catch {
        return false
      }
    })()

    // Assert
    expect(probeAllowed).toBe(true)
    expect(() => breaker.assertCallAllowed()).toThrow(CircuitOpenError)
  })

  test('it closes when the probe succeeds', () => {
    // Arrange
    const { breaker } = createHalfOpenBreaker()
    breaker.assertCallAllowed()

    // Act
    breaker.recordSuccess()

    // Assert
    expect(breaker.state).toBe(CIRCUIT_STATES.CLOSED)
    expect(() => breaker.assertCallAllowed()).not.toThrow()
    expect(logs.info).toHaveBeenLastCalledWith(
      'Circuit closed for lis-apps-cattle-home; the probe call succeeded'
    )
  })

  test('it reopens for another reset timeout when the probe fails', () => {
    // Arrange
    const { breaker, clock } = createHalfOpenBreaker()
    breaker.assertCallAllowed()

    // Act
    breaker.recordFailure()

    // Assert
    expect(breaker.state).toBe(CIRCUIT_STATES.OPEN)
    expect(logs.warn).toHaveBeenLastCalledWith(
      'Circuit opened for lis-apps-cattle-home after the probe call failed; failing fast for 500ms'
    )
    clock.time += 499
    expect(breaker.state).toBe(CIRCUIT_STATES.OPEN)
    clock.time += 1
    expect(breaker.state).toBe(CIRCUIT_STATES.HALF_OPEN)
  })
})

describe('execute()', () => {
  test('it returns the result and records a success', async () => {
    // Arrange
    const { breaker } = createBreaker({ failureThreshold: 1 })
    const call = vi.fn().mockResolvedValue('result')

    // Act
    const result = await breaker.execute(call)

    // Assert
    expect(result).toBe('result')
    expect(call).toHaveBeenCalledTimes(1)
    expect(breaker.state).toBe(CIRCUIT_STATES.CLOSED)
  })

  test('it rethrows a rejection and records a failure', async () => {
    // Arrange
    const { breaker } = createBreaker({ failureThreshold: 1 })
    const callError = new Error('socket hang up')
    const call = vi.fn().mockRejectedValue(callError)

    // Act
    let error
    try {
      await breaker.execute(call)
    } catch (e) {
      error = e
    }

    // Assert
    expect(error).toBe(callError)
    expect(breaker.state).toBe(CIRCUIT_STATES.OPEN)
  })

  test('it rejects without calling when the circuit is open', async () => {
    // Arrange
    const { breaker } = createBreaker({ failureThreshold: 1 })
    breaker.recordFailure()
    const call = vi.fn()

    // Act
    let error
    try {
      await breaker.execute(call)
    } catch (e) {
      error = e
    }

    // Assert
    expect(error).toBeInstanceOf(CircuitOpenError)
    expect(call).not.toHaveBeenCalled()
  })
})
