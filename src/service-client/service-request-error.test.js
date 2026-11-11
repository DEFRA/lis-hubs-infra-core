import { describe, expect, test } from 'vitest'

import { ServiceRequestError } from './service-request-error.js'

describe('ServiceRequestError', () => {
  test('it carries the call that failed, its status and its cause', () => {
    // Arrange
    const cause = new Error('socket hang up')

    // Act
    const error = new ServiceRequestError('Request failed - 502', {
      serviceName: 'lis-be4fe-cattle-home',
      method: 'GET',
      path: 'api/cattle',
      statusCode: 502,
      cause
    })

    // Assert
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({
      name: 'ServiceRequestError',
      message: 'Request failed - 502',
      serviceName: 'lis-be4fe-cattle-home',
      method: 'GET',
      path: 'api/cattle',
      statusCode: 502,
      cause
    })
  })

  test('it has no cause when it is the service that answered', () => {
    // Arrange
    const details = {
      serviceName: 'lis-be4fe-cattle-home',
      method: 'POST',
      path: 'api/cattle',
      statusCode: 422
    }

    // Act
    const error = new ServiceRequestError('Validation failed', details)

    // Assert
    expect(error.cause).toBeUndefined()
    expect(Object.hasOwn(error, 'cause')).toBe(false)
  })
})

describe('ServiceRequestError.fromResponse()', () => {
  const call = {
    serviceName: 'lis-be4fe-cattle-home',
    method: 'GET',
    path: 'api/cattle'
  }

  test.each([
    [
      "the service's error code and message",
      404,
      { error: { code: 'NOT_FOUND', message: 'No such animal' } },
      'NOT_FOUND - No such animal'
    ],
    [
      'the detail of a problem details body',
      400,
      { status: 400, title: 'Bad Request', detail: 'cph is required' },
      '400 - cph is required'
    ],
    [
      'the title of a problem details body with no detail',
      400,
      { status: 400, title: 'Bad Request' },
      '400 - Bad Request'
    ],
    ['a validation failure for a 422', 422, {}, 'Validation failed'],
    ['the status alone otherwise', 500, undefined, 'Request failed - 500']
  ])('it is worded from %s', (_description, statusCode, payload, message) => {
    // Arrange
    // Act
    const error = ServiceRequestError.fromResponse(call, statusCode, payload)

    // Assert
    expect(error).toBeInstanceOf(ServiceRequestError)
    expect(error).toMatchObject({ ...call, statusCode, message })
    expect(error.cause).toBeUndefined()
  })
})

describe('ServiceRequestError.fromTransportError()', () => {
  const call = {
    serviceName: 'lis-be4fe-cattle-home',
    method: 'GET',
    path: 'api/cattle'
  }

  test('it takes the status and body the transport reports', () => {
    // Arrange
    const cause = Object.assign(new Error('Client request timeout'), {
      output: { statusCode: 504 },
      data: { payload: { error: { code: 'TIMEOUT', message: 'Too slow' } } }
    })

    // Act
    const error = ServiceRequestError.fromTransportError(call, cause)

    // Assert
    expect(error).toMatchObject({
      ...call,
      statusCode: 504,
      message: 'TIMEOUT - Too slow',
      cause
    })
  })

  test('it has no status when the service could not be reached', () => {
    // Arrange
    const cause = new Error('connect ECONNREFUSED')

    // Act
    const error = ServiceRequestError.fromTransportError(call, cause)

    // Assert
    expect(error).toMatchObject({
      ...call,
      statusCode: undefined,
      message: 'Request failed - undefined',
      cause
    })
  })
})

describe('ServiceRequestError.fromReadError()', () => {
  test('it carries the status it is given and what stopped the read', () => {
    // Arrange
    const call = {
      serviceName: 'lis-be4fe-cattle-home',
      method: 'GET',
      path: 'api/cattle'
    }
    const cause = new Error('Unexpected token < in JSON')

    // Act
    const error = ServiceRequestError.fromReadError(call, 200, cause)

    // Assert
    expect(error).toMatchObject({
      ...call,
      statusCode: 200,
      message: 'Request failed - 200',
      cause
    })
  })
})
