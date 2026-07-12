# Antigravity Usage Query Design

## Goal

Add per-account Antigravity quota queries without requiring the Antigravity desktop app to be running and without switching the active account.

## Verified Protocol

- Endpoint: `POST https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary`
- Request body: `{}`
- Authentication: OAuth bearer token from the account credential stored in Windows Credential Manager
- Response: model groups containing weekly and five-hour quota buckets with `remainingFraction` and `resetTime`
- Expired access tokens can be refreshed through Google's OAuth token endpoint using Antigravity's installed-app OAuth client.

The protocol was verified against both locally registered Antigravity accounts. The current account returned the same 85% remaining five-hour Gemini quota shown by the desktop client.

## Architecture

Create `antigravityUsageService.ts` as a separate main-process module. It reads one credential through the injected `CredentialStore`, validates or refreshes the access token in memory, calls the quota summary endpoint, and maps the response into shared usage groups. It never changes the official Antigravity credential or the saved profile credential.

The existing usage IPC channels gain an optional target tool. Gemini requests continue using `usageService.ts`; Antigravity requests resolve the profile ID from settings and call the new service with that profile's Credential Manager target.

## UI

The Antigravity account table changes its second column from credential-only status to usage. Before querying it shows credential readiness and a centered query action. After querying it shows two compact groups:

- Gemini: weekly and five-hour usage
- Claude / GPT: weekly and five-hour usage

The switcher keeps its existing semantics: bars and percentages represent consumed quota, so `remainingFraction: 0.85` renders as 15% used. Reset timestamps remain available in tooltips.

## Security

- OAuth payloads remain in the Electron main process.
- Access and refresh tokens are never returned through IPC, logged, or written to settings.
- Refreshed access tokens are used in memory only.
- OAuth client credentials embedded in the app are installed-app credentials, not user secrets.
- Error messages omit response bodies that may contain sensitive details.

## Failure Handling

- Missing credential: `not_found`
- Malformed credential: `parse_error`
- Expired token without a usable refresh token: `expired`
- HTTP, timeout, and network failures: safe error result with query timestamp
- A 401 quota response triggers one refresh-and-retry when a refresh token exists.

## Testing

Unit tests cover valid-token queries, expired-token refresh, response mapping, missing credentials, malformed responses, and safe failures. Full type checking, all tests, production build, and a real Credential Manager query validate the integration.
