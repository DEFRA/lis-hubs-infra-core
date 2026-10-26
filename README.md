# lis-hubs-infra-core

Part of the Livestock Information Service (LIS), which lets livestock keepers, owners, agents and
delegates record and manage their animals.

`@defra/lis-hubs-infra-core` is a shared npm package with the runtime plumbing that every LIS hub
and spoke needs: request context and correlation IDs, logging, calls to other LIS services with
service-to-service tokens, and the hub's proxy to its spokes.

It deliberately does not cover authentication, sessions, roles or permissions (see
[lis-hubs-infra-access](https://github.com/DEFRA/lis-hubs-infra-access)) or which modules a hub
serves (see [lis-hubs-infra-registry](https://github.com/DEFRA/lis-hubs-infra-registry)).

Used by:

- hubs: [lis-hubs-front-office](https://github.com/DEFRA/lis-hubs-front-office), [lis-hubs-back-office](https://github.com/DEFRA/lis-hubs-back-office)
- spokes: [lis-apps-cattle-home](https://github.com/DEFRA/lis-apps-cattle-home), [lis-apps-cattle-register](https://github.com/DEFRA/lis-apps-cattle-register), [lis-apps-cattle-move](https://github.com/DEFRA/lis-apps-cattle-move), [lis-apps-cattle-death](https://github.com/DEFRA/lis-apps-cattle-death)
- packages: [lis-hubs-infra-access](https://github.com/DEFRA/lis-hubs-infra-access), [lis-infra-ui-services](https://github.com/DEFRA/lis-infra-ui-services)

## Installation

```bash
npm install @defra/lis-hubs-infra-core @defra/lis-hubs-infra-registry
```

`@defra/lis-hubs-infra-registry` is a peer dependency, so the consuming app must install it too.

## Usage

### Logging

`logger` is a single, shared [pino](https://getpino.io/) logger that writes
[ECS](https://www.elastic.co/guide/en/ecs/current/index.html) format for CDP's OpenSearch. Log
through it everywhere, including in request handlers. Don't use hapi's `request.logger`.

```js
import { logger } from '@defra/lis-hubs-infra-core'

logger.level = config.get('log.level')
logger.enabled = config.get('log.enabled')
logger.format = 'ecs' // or 'pretty-print' for local development
logger.serviceName = 'lis-apps-cattle-home' // defaults to SERVICE_NAME
logger.serviceVersion = config.get('serviceVersion') // defaults to SERVICE_VERSION
logger.context.hashSecret = config.get('log.hashSecret')

await server.register(logger.hapiPlugin) // request and response logging

logger.info('Holding loaded')
```

`logger.context` holds request-scoped values that are added to every log line in the request.
Pass `true` as the third argument to hash a value with `hashSecret`, so you can correlate
identifiers without logging them:

```js
logger.context.set('cph', cph, true)
```

### Request context

`requestContext.plugin` takes the correlation ID from the `x-cdp-request-id` header, or generates
one, and keeps it for the rest of the request. Register it before any other plugin.

```js
import { requestContext } from '@defra/lis-hubs-infra-core'

await server.register(requestContext.plugin)

requestContext.getHeaders() // { 'x-cdp-request-id': '...' }, for your own outbound calls
```

### Calling other LIS services

Extend `BaseClient` to call another LIS service (for example a spoke's be4fe). It:

- works out the service's base URL for the current environment (`getServiceBaseUrl`)
- adds the correlation ID header
- adds an `Authorization: Bearer` service token from AWS STS (`GetWebIdentityToken`), with the
  target service's name as the audience
- sends `x-api-key` if you give it an `apiKey`
- times out after 3 seconds by default

```js
import { BaseClient } from '@defra/lis-hubs-infra-core'

class CattleHomeBe4FeClient extends BaseClient {
  constructor({ environment, apiKey }) {
    super({
      environment,
      serviceName: 'lis-be4fe-cattle-home',
      port: 8087, // only used for 'local' and 'docker_compose'
      apiKey
    })
  }

  async getHolding(cph) {
    const { payload } = await this._get(`api/cphs/${encodeURIComponent(cph)}`)
    return payload
  }
}
```

`_get`, `_post`, `_put`, `_patch` and `_delete` take a path and
[Wreck](https://hapi.dev/module/wreck/) options. If a service token can't be obtained, they throw
`ServiceTokenError`. Other thrown errors carry `statusCode`, `serviceName`, `method`, `path` and `cause`
for code that catches the error. The shared logger emits only the error's type, message and stack,
so a caller that wants them in a log line must put them in the message or `logger.context`.

Locally, lis-dev's `lis-fake-sts` service stands in for AWS STS. See
[Service-to-service auth](https://github.com/DEFRA/lis-dev#service-to-service-auth) in lis-dev.

### Hub proxy

`createProxyPlugin` is used by hubs. It registers a proxy route for every module that
`@defra/lis-hubs-infra-registry` lists for the hub, forwarding requests to that module's spoke and
forwarding only the hub JWT cookie and any cookies named in `forwardedCookieNames` (for example
the cookie consent choice, which the spoke's layout needs to decide whether to show the banner),
never the hub session cookie or the `Authorization` header.

```js
import { createProxyPlugin } from '@defra/lis-hubs-infra-core'
import { COOKIES_POLICY_COOKIE_NAME } from '@defra/lis-infra-ui-services/cookies/cookies-policy'

const proxy = createProxyPlugin({
  hubId: 'front-office',
  environment: config.get('environment'),
  hubJwtCookieName: config.get('auth.hubJwt.cookieName'),
  forwardedCookieNames: [COOKIES_POLICY_COOKIE_NAME] // optional, none by default
})

await server.register(proxy.plugin)
```

### Environment variables

The package reads these, falling back to them when the consumer doesn't set the values directly:

| Variable               | Used for                                       |
| ---------------------- | ---------------------------------------------- |
| `SERVICE_NAME`         | `logger.serviceName`                           |
| `SERVICE_VERSION`      | `logger.serviceVersion`                        |
| `AWS_REGION`           | AWS STS region, for service tokens             |
| `AWS_ENDPOINT_URL_STS` | AWS STS endpoint override (lis-dev's fake STS) |

On CDP the platform sets these. In lis-dev, the compose files set them.

## Prerequisites

- Node.js 24 (see `.nvmrc`, use `nvm use`)
- To check changes against a consuming app: a local clone of [lis-dev](https://github.com/DEFRA/lis-dev) with its one-time setup done

## Setup

### Development

```bash
nvm use
npm install
```

### Test

There are no tools to install beyond `npm install`. Tests use [Vitest](https://vitest.dev/).

## Running in development

This is a library, so it has no server of its own. To try a change in a consuming app without
publishing, link the local copy into the lis-dev stack:

```bash
cd lis-dev
.bin/sideload link hubs/infra-core # every installed copy now points at this repo
.bin/sideload up front-office       # optional: run a consumer locally with hot reload
.bin/sideload unlink hubs/infra-core # when done
```

## Running tests

```bash
npm test                 # unit tests
npm run test:coverage    # with coverage
npm run lint             # ESLint
npm run format:check     # Prettier
```

Before releasing a change, also run the tests of each consuming repo against the linked package.

## Pipelines

Build, versioning and publishing run in GitHub Actions (`.github/workflows`) using Cake scripts (`*.cake`):

- **Pull request to `main`**: validate (format, lint, test), Sonar analysis, version check
- **Push to a `feature/` or `hotfix/` branch**: prerelease version and tag
- **Merge to `main`**: release tag, then publish to [npm](https://www.npmjs.com/package/@defra/lis-hubs-infra-core)

Versions come from git tags (SemVer). After a merge, wait for the publish job to finish before bumping the package in consuming repos.

## Branching policy

The repo uses mainline development. Branch from `main` and name the branch:

- `feature/LREG-<ticket>-<short-kebab-description>`
- `hotfix/LREG-<ticket>-<short-kebab-description>`

`LREG` must be uppercase, because the GitHub ruleset rejects other branch names. Rebase onto `main`
rather than merging `main` in.

## Contributing to this project

- Follow the [Defra software development standards](https://github.com/DEFRA/software-development-standards).
- `npm install` sets up a pre-commit hook (Husky) that runs the security audit, format check and lint.
- Open a pull request against `main` using the PR template. CI must pass and the Sonar quality gate must be green before merge.

## Licence

THIS INFORMATION IS LICENSED UNDER THE CONDITIONS OF THE OPEN GOVERNMENT LICENCE found at:

<http://www.nationalarchives.gov.uk/doc/open-government-licence/version/3>

The following attribution statement MUST be cited in your products and applications when using this information.

> Contains public sector information licensed under the Open Government licence v3

### About the licence

The Open Government Licence (OGL) was developed by the Controller of His Majesty's Stationery Office (HMSO) to enable information providers in the public sector to license the use and re-use of their information under a common open licence.

It is designed to encourage use and re-use of information freely and flexibly, with only a few conditions.
