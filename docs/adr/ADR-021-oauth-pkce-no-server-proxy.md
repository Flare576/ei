# ADR-021: Third-Party OAuth Uses PKCE Directly Against the Provider, Never an Ei-Hosted Proxy

## Status

Accepted

## Date

2026-08-03

## Context

Ei ships as a static web app plus a distributed TUI binary — there is no Ei-run backend process
that could safely hold a confidential OAuth client secret. The project's own framing is explicit
about this: Ei is "always going to be **YOURS** — [Local First]" (`README.md:3`), and the shipped
Slack app manifest promises reviewers and installers that the integration "Runs entirely on your
device — no data is sent to Ei's servers" and "Store[s] anything server-side" is explicitly listed
under "What this app does NOT do" (`slack_manifest.yaml`'s `long_description`, lines 13-18).

Two third-party integrations need real OAuth today: **Spotify** (two builtin LLM tools,
`get_currently_playing` and `get_liked_songs`) and **Slack** (workspace history/DM indexing for
persona memory, `src/integrations/slack/`). Both need a flow that works identically from a browser
tab (the web app) and from a user's own terminal (the TUI), and both need a refresh token that
survives past a short-lived access token — ruling out the Implicit grant, which neither provider
issues a refresh token for.

The classic alternative — Authorization Code + a confidential `client_secret`, exchanged by a
server Ei operates — requires exactly the kind of backend Ei doesn't run for its own logic. Baking
a `client_secret` into the web bundle or the TUI binary anyway would not make it confidential: it
would be readable from browser devtools or `strings` on the binary by anyone who downloaded either.
This is precisely the problem PKCE (RFC 7636) exists to solve: a "public client" (no persisted
secret) can still prove it's the same party that started the flow, per-flow, without ever holding a
long-lived credential.

## Decision

**Both integrations use Authorization Code + PKCE (S256) only. No client secret is defined or
required for either provider. Every code-for-token exchange is a direct fetch from the browser or
from a short-lived local process on the user's own machine straight to the provider's token
endpoint — never through any server Ei operates.**

### Shared mechanics

One file backs all four flows (2 providers × {web, TUI}): `src/core/tools/builtin/pkce.ts`.

- `generateVerifier()` — a random 96-byte value, base64url-encoded to a 128-character string
  (`pkce.ts:8-12`).
- `generateChallenge(verifier)` — SHA-256 of the verifier, base64url-encoded, via `crypto.subtle`
  (`pkce.ts:14-19`) — works unmodified in both the browser and Bun (the TUI's runtime).
- `buildAuthUrl(...)` — assembles the provider's `/authorize` URL with `client_id`,
  `redirect_uri`, `code_challenge`, `code_challenge_method=S256`, and either a flat `scope` param
  (Spotify) or a separate `user_scope` param (Slack's bot-vs-user-scope split) (`pkce.ts:69-98`).
- `exchangeCode(...)` — POSTs `grant_type=authorization_code` + `code` + `redirect_uri` +
  `client_id` + `code_verifier` to the token endpoint, with an optional `tokenResponsePath` to
  unwrap a nested response shape (`pkce.ts:21-67`). This one option exists because the two
  providers' token responses are *not* shaped the same way — see below.

Both providers' refresh helpers share an identical pattern: cache the current access token +
expiry in module scope, refresh via `grant_type=refresh_token` when within 60 seconds of expiry,
and — because both providers may rotate the refresh token on use — invoke a caller-supplied
`onTokenRotated` callback with the new value so it can be persisted
(`src/core/tools/builtin/spotify-auth.ts:32-75`, `src/core/tools/builtin/slack-auth.ts:50-102`).

### Spotify

- Client ID `41a10178f66946f78d4a1e265606ba36` is public, embedded directly in source
  (`spotify-auth.ts:11`); no `client_secret` exists anywhere in this repository — confirmed by
  direct search across `src/`, `tui/`, `web/`, and `.github/` for `client_secret`/`CLIENT_SECRET`,
  which returns no hits outside the PKCE code's own `code_verifier` parameter name.
- Scopes: `user-read-currently-playing`, `user-library-read` (`spotify-auth.ts:12`).
- **Web redirect**: `https://ei.flare576.com/callback/spotify` (`spotify-auth.ts:15`). The React
  app's `useOAuthCallbacks` hook matches any `/callback/:provider` path, reads the verifier back
  out of `sessionStorage`, calls `exchangeCode` directly against
  `https://accounts.spotify.com/api/token`, and — once a `Processor` instance exists — calls
  `processor.updateToolProvider('spotify', { config: { spotify_refresh_token }, enabled: true })`
  (`web/src/hooks/useOAuthCallbacks.ts:24-61`). The button itself
  (`web/src/components/Settings/SpotifyAuthButton.tsx:36-51`) generates the verifier/challenge and
  redirects `window.location` — it never talks to any Ei-controlled server.
- **TUI redirect**: `http://127.0.0.1:4242`, a **fixed** port (`spotify-auth.ts:17-18`). Spotify's
  own developer console rejects a bare, un-ported loopback URI at registration time, so the TUI
  binds `Bun.serve` directly to port 4242 on `127.0.0.1` and prints the resulting `/authorize` URL
  for the user to open (`tui/src/commands/spotify-auth.ts:34-58,117-159`). The callback handler
  only accepts requests to path `/` (`:125`), reads `?code=`/`?error=`, and — critically — starts
  the server *before* opening the browser so it's already listening when Spotify redirects back
  (`:42-48`). A 120-second timeout (`TIMEOUT_MS = 120_000`, `:97`) tears the server down and
  surfaces an error notification if no callback arrives.
- **Refresh**: `getSpotifyAccessToken(refreshToken, onTokenRotated)` is invoked on *every* call to
  either builtin tool (`currently-playing.ts:25-35`, `spotify-liked-songs.ts:77-92`), each wiring
  `onTokenRotated` straight into the tool's `onConfigUpdate` callback so a rotated refresh token
  is written back into `ToolProvider.config` immediately.
- **Storage**: `ToolProvider.config.spotify_refresh_token`, seeded empty by
  `bootstrap-tools.ts:255-266` when the builtin `spotify` provider is first created, and populated
  by either auth flow via `updateToolProvider`. There is exactly one Spotify connection per Ei
  install — `ToolProvider` has no per-account or per-workspace concept.

### Slack

- Client ID `11080256060354.11080294064034` is public, embedded in source (`slack-auth.ts:15`); no
  `client_secret` exists in this repository for Slack either, by the same direct search above.
- User scopes: `channels:history`, `channels:read`, `groups:history`, `groups:read`, `im:history`,
  `im:read`, `mpim:history`, `mpim:read`, `users:read`, `users:read.email` (`slack-auth.ts:17-28`,
  matching `slack_manifest.yaml:31-41`) — all read-only, requested as Slack's separate
  **user**-token scope (`user_scope`), with an empty bot-token `scope` param, because Ei never
  posts or reacts (`slack_manifest.yaml`'s explicit "What this app does NOT do" list, lines 15-18).
  This bot/user scope split is a Slack-specific concept Spotify's OAuth has no equivalent of.
- **Web redirect**: `https://ei.flare576.com/callback/slack` (`slack-auth.ts:36`), mirroring
  Spotify's web shape exactly:
  `web/src/components/Settings/SlackAuthButton.tsx:24-39` generates the verifier/challenge, stores
  the verifier in `sessionStorage`, and redirects to
  `https://slack.com/oauth/v2/authorize`. `useOAuthCallbacks`'s `slack` branch calls `exchangeCode`
  against `https://slack.com/api/oauth.v2.access` with `tokenResponsePath: ['authed_user']`
  (`useOAuthCallbacks.ts:71-77`) — **Slack nests the actual token fields one level deeper than
  Spotify does**, under `authed_user`, which is exactly the shape difference `exchangeCode`'s
  optional `tokenResponsePath` parameter exists to absorb generically rather than with a
  per-provider branch. The resolved tokens are then written into
  `human.settings.slack.workspaces[workspace_id].auth`, keyed by the `team.id` Slack returns
  alongside the tokens (`useOAuthCallbacks.ts:78-117`).
- **TUI redirect — the one place the two patterns genuinely diverge**: Slack requires every
  registered redirect URL for a public/PKCE client to be HTTPS; a bare `http://127.0.0.1:...`, of
  the kind Spotify accepts once pinned to a fixed port, is rejected outright
  (`slack-auth.ts:30-31`'s comment: *"Slack requires HTTPS for distributed apps, so we relay
  through ei.flare576.com/callback/slack/tui which does a 302 to localhost"*). Ei solves this with
  a tiny, stateless, static relay it hosts on its own web domain
  (`web/public/callback/slack/tui.php`): Slack redirects to
  `https://ei.flare576.com/callback/slack/tui?code=...`, and that PHP file immediately issues an
  HTTP 302 to `http://127.0.0.1:4243/?code=...` (`tui.php:18-31`), forwarding `code`, `error`, and
  `state` unchanged. `.htaccess` rewrites the extensionless URL to the `.php` file
  (`web/public/.htaccess:4-5`). **This relay never sees, stores, or exchanges a token — it
  redirects one query string and exits.** It is not the server-side proxy this decision rejects;
  it exists solely because Slack's redirect-URL scheme requirement (HTTPS) is stricter than
  Spotify's (any scheme, once the port is fixed), not because Slack's *token exchange* needs a
  server in the middle. The actual code exchange still happens from the TUI's own local process,
  directly against `slack.com`, exactly like Spotify's. The local Bun server binds
  `127.0.0.1:4243` (`SLACK_TUI_PORT`, `slack-auth.ts:33`), accepts only path `/`, and uses the same
  120-second timeout pattern as Spotify's TUI flow (`tui/src/commands/slack-auth.ts:103,117-121`).
- **Refresh — the one place the code diverges without a corresponding design note**:
  `getSlackAccessToken(refreshToken, onTokenRotated)` exists with the exact same shape as
  Spotify's helper (`slack-auth.ts:50-102`), but a repository-wide search finds **zero call sites**
  for it outside its own definition. `SlackReader`, the class that actually performs Slack API
  calls during workspace sync, reads `this.auth.token` directly and uses it unrefreshed for the
  life of the connection (`src/integrations/slack/reader.ts:90-116`); it never calls
  `getSlackAccessToken`. This is consistent with the app's current manifest setting
  `token_rotation_enabled: false` (`slack_manifest.yaml:46`) — access tokens for Ei's HTTPS-redirect
  PKCE app are not on an expiring/rotating schedule under that setting per Slack's own
  authentication documentation — but it means the refresh-and-persist pattern the code visually
  implies for Slack, by mirroring Spotify's helper one-for-one, is not currently exercised anywhere
  in this codebase.
- **Storage**: `HumanSettings.slack.workspaces[workspace_id].auth`
  (`src/integrations/slack/types.ts:30-43`), a `Record` keyed by Slack workspace ID rather than a
  single config bag — **the one structural difference driven by the domain, not the auth
  mechanism**: a user can plausibly connect more than one Slack workspace, where Spotify has
  exactly one global account per Ei install. `SlackAuth` is itself a union
  (`types.ts:1-21`): the OAuth/PKCE shape this decision covers (`SlackAuthOAuth`, carrying
  `token`/`refresh_token`/`workspace_name`) coexists with a second, non-OAuth `SlackAuthBrowser`
  variant (raw `xoxc`/`xoxd` session cookies extracted from the Slack desktop app or DevTools,
  `types.ts:14-19`) for workspaces where a user has no admin-installable app. That second path is
  out of scope for this decision — it isn't OAuth at all — but it's why `SlackAuth` is a
  discriminated union rather than a single shape, and why `SlackReader.slackFetch`
  (`reader.ts:98-116`) branches on `auth.type` before building request headers.

## Alternatives Considered

### A: Confidential client + client_secret, exchanged by an Ei-run server-side OAuth proxy/broker

- **Pros**: not constrained to whatever a PKCE-only public client can do; a single
  Ei-controlled backend could act as the token-exchange broker for every install without
  per-user redirect-URI juggling.
- **Cons**: Ei does not run a backend server for its own logic today — one would need to be stood
  up, hosted, and kept available *just* for this, and a real secret would need to live on
  infrastructure outside the user's own machine. That directly contradicts the local-first
  promise this project makes to its users and, for Slack specifically, to Slack's own app-review
  process (`slack_manifest.yaml`'s explicit "does NOT... [s]tore anything server-side").
- **Why not chosen**: it re-centralizes exactly the thing ("your data never leaves your device")
  the project is built to avoid, in exchange for capabilities (see Consequences/Negative) neither
  integration currently needs.

### B: Implicit grant (token returned in the redirect fragment, no code exchange)

- **Pros**: one fewer network round-trip; no code-exchange step at all.
- **Cons**: neither provider issues a refresh token under Implicit, and both integrations need
  sessions that outlive a multi-hour access token without re-prompting the user in a browser every
  time. Implicit also exposes the token itself in browser history/referrer headers, which PKCE was
  designed to avoid.
- **Why not chosen**: not viable for either provider's current OAuth v2 surface given the scopes
  and refresh lifetime both integrations require.

### C: Dynamic/OS-assigned local port for the TUI redirect

- **Description**: let the TUI bind whatever free ephemeral port the OS hands it and print that
  port into the generated auth URL, rather than a fixed pre-registered one.
- **Cons**: both providers require every redirect URI to be registered exactly in advance in their
  developer console; a port chosen at runtime cannot be pre-registered.
- **Why not chosen**: not supported by either provider. Both TUI flows now bind a single
  pre-registered fixed port instead (Spotify 4242, Slack 4243) — see Consequences/Negative for the
  collision risk this trades in.

### D: Register a bare loopback HTTP redirect for Slack, exactly like Spotify's

- **Description**: register `http://127.0.0.1:4243` directly with Slack the same way
  `http://127.0.0.1:4242` is registered with Spotify, skipping the HTTPS relay entirely.
- **Cons**: Spotify accepts a *fixed-port* loopback HTTP URI (it only rejects a *dynamic-port*
  one); Slack rejects bare loopback HTTP outright for a public/PKCE client, regardless of port,
  because it requires HTTPS on every registered redirect URL for that app type.
- **Why not chosen**: not supported by Slack. Solved instead by the stateless HTTPS→loopback relay
  described above, which adds one hop but changes nothing about who exchanges the code for a
  token (still the TUI's own local process, never the relay).

## Consequences

### Positive

- No provider secret exists anywhere a leak could occur — not in the web bundle, not in the TUI
  binary, not in a config file a user might paste into a support channel by mistake. Verified by
  direct search: no `client_secret`/`CLIENT_SECRET` string appears anywhere in `src/`, `tui/`,
  `web/`, or `.github/` for either provider.
- One shared implementation (`pkce.ts`) backs all four flows. The security-critical
  verifier/challenge/exchange logic exists exactly once, not duplicated per provider or per
  surface — a future third integration (GitHub, etc.) reuses it directly rather than reinventing
  it, exactly as the two existing integrations already do.
- Matches what Ei tells its users and Slack's own reviewers: nothing about either token exchange
  ever needs to reach a server Ei operates.

### Negative

- Fixed local TUI ports (4242 Spotify, 4243 Slack) are a real, narrow collision risk: if a user
  already has something else bound to that exact port when running `/auth spotify` or
  `/auth slack`, `Bun.serve` fails to bind and the flow cannot complete until the conflict clears
  — surfaced today as a generic "Failed to start local auth server" notification
  (`tui/src/commands/spotify-auth.ts:160-166`, `tui/src/commands/slack-auth.ts:165-171`), not a
  port-specific one.
- Slack's HTTPS-redirect requirement means the TUI flow now depends on an internet-reachable page
  Ei itself hosts (`ei.flare576.com/callback/slack/tui`) purely to bounce a query string to
  localhost. Spotify's TUI flow has no equivalent external dependency — it is loopback-only, start
  to finish. `web/public/terms.html` calls this out directly to users: "these are one-time flows;
  existing tokens are unaffected if they go down" — but a **first-time** Slack TUI connection
  cannot complete while that relay is unreachable, even though no token or code is ever readable
  by it.
- The two providers' refresh-persistence code is asymmetric in a way that is easy to misread by
  inspection alone: Spotify's rotation callback is wired into both builtin tool executors and
  fires on effectively every tool call; Slack's identically-shaped helper
  (`getSlackAccessToken`) has no call site anywhere in this codebase — `SlackReader` uses the
  access token captured at auth time, unrefreshed, indefinitely. That happens to be consistent
  with Slack's current `token_rotation_enabled: false` manifest setting, but nothing in the code
  states this; a maintainer skimming `slack-auth.ts` alongside `spotify-auth.ts` could reasonably
  — and incorrectly — assume both are exercised the same way.
- PKCE-only, with no confidential-client fallback, permanently caps what Ei can ever do
  server-side with either credential: no scheduled poll from infrastructure Ei controls, no
  handing a durable token to a second device without repeating the human-in-the-loop browser
  consent step, because no server either provider trusts ever holds these credentials on Ei's
  behalf. That is the intended trade-off, but it is now baked into two production OAuth app
  registrations that took real, one-time manual console configuration to set up; reversing course
  later means new app registrations, not a code-only change (see Reversibility).

### Risks

- **Refresh tokens sit in plaintext at rest, contrary to what the type definition claims.**
  `ToolProvider.config`'s own comment reads "Shared API keys / base URLs (**encrypted at rest**)"
  (`src/core/types/integrations.ts:20`), but that is not true for either local storage backend the
  TUI or the web app actually use. The TUI's `FileStorage` writes `state.json` as deliberately
  "uncompressed JSON on disk [to stay] human-readable and debuggable" — no encryption at all, by
  explicit design comment (`src/storage/compress.ts:10-11`). The browser's `LocalStorage` and
  `IndexedDBStorage` backends gzip-compress the serialized state before writing
  (`src/storage/local.ts:25-30`, `src/storage/indexed.ts:27-38`) — compression is not encryption
  and is trivially reversible by anyone who can read the stored bytes. The only real encryption in
  Ei (AES-GCM-256, key derived via PBKDF2, per `src/storage/crypto.ts:66-77`) applies exclusively
  to the *optional* remote-sync backup blob uploaded to `flare576.com`
  (`CONTRACTS.md:259-272`'s storage table and Security Model section) — never to anything sitting
  on the user's own machine or in their own browser's storage. A Spotify or Slack refresh token is
  therefore protected by nothing beyond whatever protects the rest of a user's local Ei data: a
  filesystem read on the TUI's data directory, or the browser's own storage sandbox for the web
  app. This ADR corrects that stale comment rather than repeating it.
- **A stolen refresh token is a durable, secret-free credential.** PKCE protects the *authorization*
  step — an attacker without the matching verifier cannot complete a *new* code exchange even with
  a captured `code` — but provides no protection at all once a valid refresh token already exists
  in `state.json` or browser storage. Redeeming it needs no client secret, by design.
- **The dormant Slack refresh path is a latent trap, not a resolved decision.** Slack's own product
  documentation states that flipping `token_rotation_enabled` to `true` cannot be reversed without
  contacting Slack support. If that setting is ever changed on the registered app — deliberately
  or by a future maintainer following Slack's general security recommendations — the currently
  unwired `getSlackAccessToken`/`onTokenRotated` path becomes load-bearing overnight, with zero
  existing test or production coverage of the moment it starts actually running.

## Reversibility

**Moderate-to-hard to abandon; cheap to extend.** Moving to a confidential-client/server-proxy flow
later would not require a data-model change — the same `refresh_token`-shaped storage keeps
working — but it does require standing up and operating a server Ei does not run today,
provisioning and protecting a real secret on it, and reconfiguring or re-registering both
provider apps to add a confidential redirect target. None of that is a code-only change, and it
reopens exactly the local-first trade-off this decision was written to preserve.

Extending in the other direction is cheap: wiring Slack's dormant refresh path into
`SlackReader`/the importer needs only a call site with a callback writing back into
`human.settings.slack.workspaces[id].auth.refresh_token` — the helper, its 60-second buffer, and
its rotation-callback shape already exist, unchanged from Spotify's pattern. Adding a third PKCE
integration (e.g. GitHub) reuses `pkce.ts` directly and needs no new security-critical code, only a
new pair of `*-auth.ts` constants files and, if the provider also requires HTTPS-only redirects for
its TUI flow, a second copy of the Slack-style static relay.

## References

- `src/core/tools/builtin/pkce.ts` — shared `generateVerifier`/`generateChallenge`/`buildAuthUrl`/
  `exchangeCode`, used by all four flows
- `src/core/tools/builtin/spotify-auth.ts:11-18,32-90` — Spotify client id/scopes/redirect URIs,
  `getSpotifyAccessToken`
- `src/core/tools/builtin/currently-playing.ts:25-35`,
  `src/core/tools/builtin/spotify-liked-songs.ts:77-92` — the two live call sites for Spotify's
  refresh+rotation path
- `tui/src/commands/spotify-auth.ts:34-58,94-168` — TUI flow: fixed port 4242, 120s timeout, direct
  loopback redirect_uri
- `web/src/components/Settings/SpotifyAuthButton.tsx:36-51`,
  `web/src/hooks/useOAuthCallbacks.ts:24-61` — web flow
- `src/core/bootstrap-tools.ts:255-266` — seeded `spotify` `ToolProvider` with empty
  `spotify_refresh_token`
- `src/core/tools/builtin/slack-auth.ts:15-117` — Slack client id/scopes/redirect URIs,
  `getSlackAccessToken` (unwired)
- `tui/src/commands/slack-auth.ts:17-98,101-173` — TUI flow: fixed port 4243, HTTPS relay
  redirect_uri, 120s timeout
- `web/src/components/Settings/SlackAuthButton.tsx:24-39`,
  `web/src/hooks/useOAuthCallbacks.ts:63-122` — web flow
- `web/public/callback/slack/tui.php`, `web/public/.htaccess:4-8` — the stateless HTTPS→loopback
  relay for the Slack TUI flow
- `slack_manifest.yaml:26-47` — registered redirect URLs, scopes, `pkce_enabled: true`,
  `token_rotation_enabled: false`
- `src/integrations/slack/reader.ts:85-116` — `SlackReader` reading `auth.token` directly,
  unrefreshed
- `src/integrations/slack/types.ts:1-48` — `SlackAuth` union, workspace-scoped storage shape
- `src/core/types/integrations.ts:9-23` — `ToolProvider.config`, Spotify's storage location, and
  its inaccurate "(encrypted at rest)" comment
- `src/storage/compress.ts:1-12`, `src/storage/local.ts:25-30`, `src/storage/indexed.ts:27-38`,
  `src/storage/crypto.ts:66-77`, `CONTRACTS.md:259-272` — the actual storage/encryption boundaries
