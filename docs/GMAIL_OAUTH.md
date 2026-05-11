# Gmail OAuth — first-party setup for "Scan email"

## Why this exists

Donnit's `Scan email` function reads **unread Gmail** directly and surfaces
suggested action items to the user. There are two execution paths:

1. **Platform connector** — used inside the Perplexity Computer preview. Calls
   the `external-tool` CLI with `source_id=gcal`, `tool_name=search_email`. This
   path requires the app process to have a valid runtime credential, which the
   hosted preview cannot always provide (it returns bare `UNAUTHORIZED`).
2. **First-party Gmail OAuth** — used in production and any deploy where
   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` are
   configured. Each Donnit user authorizes Donnit once via Google's OAuth
   consent screen; tokens are stored server-side in `donnit.gmail_accounts`
   (RLS-gated, never exposed to the browser).

The server prefers (2) when a stored token exists for the signed-in user, and
falls back to (1) otherwise. The two paths produce identical
`donnit.email_suggestions` rows.

## What Aaron must do

These are the exact external setup tasks. The application will not be able to
scan Gmail in production until all of them are complete.

### 1. Google Cloud project

1. Open <https://console.cloud.google.com/> and select (or create) a project
   for Donnit.
2. **APIs & Services → Library** → search for **Gmail API** → click
   **Enable**.

### 2. OAuth consent screen

1. **APIs & Services → OAuth consent screen**.
2. User type: **External**. Click **Create**.
3. App name: `Donnit`. User support email: your address. Developer contact: your
   address.
4. Authorized domains: add `donnit.ai` (and any other production domain you
   intend to host on).
5. **Scopes** -> **Add or remove scopes** -> add:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/calendar.events`

   Donnit reads unread Gmail to suggest tasks, sends only user-approved email
   replies, and writes approved agenda blocks to Google Calendar.
6. **Test users** (while the app is in Testing): add the Gmail addresses of
   Aaron and any other internal testers. Once the consent screen is published
   and verified, this list is no longer required.

### 3. OAuth client

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. Application type: **Web application**.
3. Name: `Donnit web`.
4. **Authorized redirect URIs** — add **exactly** the URL the deployed Donnit
   server will receive the OAuth callback on:
   - Production: `https://donnit.ai/api/integrations/gmail/oauth/callback`
   - Per-environment preview: `https://<your-preview-host>/api/integrations/gmail/oauth/callback`
   These must match the value of `GOOGLE_REDIRECT_URI` byte-for-byte (no
   trailing slash, no fragment, scheme included).
5. Click **Create**. Copy the **Client ID** and **Client secret**.

### 4. Server environment variables

Set these on the deployed Donnit server (Vercel / Railway / your host of
choice). Do NOT commit them.

```
GOOGLE_CLIENT_ID=<from step 3>
GOOGLE_CLIENT_SECRET=<from step 3>
GOOGLE_REDIRECT_URI=https://donnit.ai/api/integrations/gmail/oauth/callback
```

Restart / redeploy the server. The `Connect Gmail` button only appears in the
UI when `GET /api/integrations/gmail/oauth/status` reports
`configured: true`.

### 5. Apply the Supabase migration

The OAuth path needs a token-storage table and three new columns on
`donnit.email_suggestions`. The migration file lives at
`supabase/migrations/0006_email_suggestions_body_and_gmail_accounts.sql`. It is
non-destructive and re-runnable.

Apply it with whatever workflow the project uses for prior migrations (psql,
Supabase Dashboard SQL editor, or `supabase db push` if the CLI is wired up).
A safe one-shot via the dashboard:

1. Supabase → SQL editor → paste the contents of `0006_*.sql` → Run.
2. Confirm in **Table editor** that `donnit.gmail_accounts` exists and that
   `donnit.email_suggestions` now has `body`, `received_at`, `action_items`.

There is **no automatic apply** in this PR — Aaron must run the migration
explicitly.

### 6. Smoke test the OAuth flow

1. Sign in to Donnit on the deployed URL.
2. Click `Connect Gmail` in the toolbar (only visible when OAuth is
   configured and the user is not yet connected).
3. Complete Google's consent dialog. The browser is redirected back to
   `/api/integrations/gmail/oauth/callback`, which writes a row to
   `donnit.gmail_accounts` and renders a small confirmation page.
4. Return to Donnit. The toolbar now shows `Disconnect Gmail` and the footer
   shows `Gmail OAuth: <your address>`.
5. Click `Scan email`. The toast should say
   `Added N new unread emails to your queue` (or similar). The Waiting-on-you
   panel now shows email suggestions with sender, received date, body
   preview, and extracted action items.
6. Approve a suggestion. A task is created in the To-do list with the
   suggestion's title, due date, and urgency.

## Encrypting tokens (recommended for production)

The migration stores `access_token` and `refresh_token` as plain text. RLS
restricts access to `auth.uid() = user_id`, but a defense-in-depth deployment
should wrap those columns with `pgsodium`-managed transparent encryption.
That is out of scope for this PR; track as a follow-up.

## Troubleshooting

### `Access blocked: Authorization Error … doesn't comply with Google's OAuth 2.0 policy for keeping apps secure. Error 400: invalid_request`

Google rejects the request before the consent screen renders. The Donnit
server has already built a textbook authorization URL (`response_type=code`,
URL-encoded `scope`, `redirect_uri`, `state`, `access_type=offline`,
`prompt=consent`), so this error always points at the **Google Cloud OAuth
client configuration**, not at Donnit code. Check, in order:

1. **OAuth client type must be `Web application`.** This is the #1 cause of
   this exact error. If the client was created as `Desktop`, `iOS`, `Android`,
   `TV/Limited input`, or `Other`, Google blocks the standard browser-redirect
   flow with this generic policy message. Fix: APIs & Services → Credentials
   → delete the wrong client → Create credentials → OAuth client ID →
   **Application type: Web application**. Copy the new Client ID/Secret into
   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and redeploy.

2. **`GOOGLE_REDIRECT_URI` must match an Authorized redirect URI byte-for-byte.**
   Open the OAuth client and confirm the **Authorized redirect URIs** list
   contains the exact value of `GOOGLE_REDIRECT_URI`:
   - Same scheme (`https://`).
   - Same host. If you are testing on the Vercel preview
     `https://donnit-1.vercel.app`, the registered URI must be
     `https://donnit-1.vercel.app/api/integrations/gmail/oauth/callback`,
     **not** `https://donnit.ai/...`. Add both if you test on both.
   - Same path (`/api/integrations/gmail/oauth/callback`). No trailing slash.
   - No `#` fragment, no query string.
   Note: Google propagates redirect-URI changes within seconds, but caches in
   the consent screen can be stale for a minute.

3. **No placeholder values in env.** If `GOOGLE_CLIENT_ID` is literally
   `<from step 3>` or similar, Google returns this same generic error. Hit
   `/api/health` — it reports presence (boolean) of each env var; for the
   actual values, run `vercel env ls` or open the Vercel project settings.

4. **`client_id` must come from the same Google Cloud project as the OAuth
   consent screen.** If you have multiple projects, copying a client ID from
   project A while the consent screen lives in project B produces this error.

5. **Consent screen must be configured for `External` user type** (unless the
   project is in a Workspace org and you explicitly want `Internal`). The
   consent screen needs a published `App name`, support email, and developer
   contact email before it will serve any user.

6. **OAuth client must not be deleted/disabled.** A common pitfall: rotating
   to a new client without updating the env. Confirm the client referenced by
   `GOOGLE_CLIENT_ID` still exists in the Credentials list.

### `Error 403: access_denied` (or "Donnit has not completed the Google verification process")

Distinct from the policy error above. The consent screen passed Google's
policy check but the user is not allowed to consent because:

- **App is in `Testing` mode and the user is not a registered test user.**
  Fix: APIs & Services → OAuth consent screen → **Test users** → add the
  exact Gmail address you are signing in with. Up to 100 test users are
  allowed without verification.
- **App is in `In production` (Published) with the sensitive
  `gmail.readonly` scope and has not completed Google verification.** A
  published app with a sensitive/restricted scope serves only the developer's
  own account until verification is approved (which can take weeks and
  requires a homepage, privacy policy, demo video, and a CASA security
  assessment). For developer-only / internal testing, **keep the app in
  Testing** and add yourself as a test user — that avoids verification
  entirely.

### `redirect_uri_mismatch`

A more specific variant of (2) above. Google tells you the URI it received;
copy that string and add it verbatim to **Authorized redirect URIs**.

### `Gmail token exchange failed` (toast after consent screen)

The user clicked **Connect Gmail**, completed Google's consent screen, and was
redirected back to Donnit — but the server's POST to
`https://oauth2.googleapis.com/token` was rejected. The callback redirects to
one of five typed reasons; the SPA toast tells you which **and** appends
Google's own `error` / `error_description` so you can see exactly what Google
said. The full diagnostic line in the Vercel function log is:

```
[donnit] gmail token exchange failed: {
  "status": 400,
  "googleError": "<Google's documented error code>",
  "googleErrorDescription": "<Google's short description>",
  "reason": "<our typed reason>",
  "redirectUri": "<the exact redirect_uri the server sent to Google>"
}
```

The `redirectUri` field is the public callback URL — it is logged so an
operator can diff it byte-for-byte against the **Authorized redirect URIs**
list on the OAuth client. The auth code, client secret, access token, and
refresh token are NEVER logged.

#### Triage by typed reason

- **`?gmail=redirect_mismatch`** — Google returned `redirect_uri_mismatch`, or
  `invalid_request` with a description mentioning redirect_uri. The
  `redirect_uri` Donnit sent to `/token` does not match an Authorized redirect
  URI on the OAuth client. Donnit always reuses `GOOGLE_REDIRECT_URI` for both
  the auth URL and the token exchange, so the fix is on Google's side: open the
  OAuth client and confirm **Authorized redirect URIs** contains the exact value
  of `GOOGLE_REDIRECT_URI` (same scheme, host, path, no trailing slash, no
  query/fragment). Compare it against the `redirectUri` field in the server log.
  Common gotcha: testing on a Vercel preview
  (`donnit-1-<hash>.vercel.app`) while only the production URL is registered —
  add both, or set `GOOGLE_REDIRECT_URI` to whichever host you are actually
  serving from.

- **`?gmail=invalid_client`** — Google returned `invalid_client` /
  `unauthorized_client`. The client ID/secret pair was rejected. Causes:
  1. `GOOGLE_CLIENT_SECRET` was rotated in the Google Console but not updated
     in the Vercel env (or only updated for one environment — Production vs
     Preview vs Development).
  2. `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` come from different OAuth
     clients (copy/paste from the wrong row).
  3. The OAuth client was deleted/disabled.
  4. Whitespace or stray newline pasted into the env var. (Vercel's UI
     occasionally adds a trailing newline if you paste from a clipboard that
     wraps; re-enter the value typing instead of pasting if you suspect this.)
  5. The client type is not **Web application** — Desktop / iOS / Android
     clients cannot accept the standard browser-redirect grant.
  Fix: APIs & Services → Credentials → open the client → either copy the
  existing secret or click **Reset Secret**. Update both
  `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on Vercel for **all**
  environments that serve the redirect URI, then redeploy.

- **`?gmail=invalid_grant`** — Google returned `invalid_grant`. The
  authorization code itself was rejected. Causes, in order of likelihood:
  1. **Code was already used.** Authorization codes are single-use. This
     usually means the callback fired twice — e.g. the user clicked back,
     refreshed the callback page, or a double-redirect happened. Click
     **Connect Gmail** again to start a fresh authorization. The fresh code
     will work.
  2. **Code expired.** Google codes are valid for ~10 minutes; if the user got
     stuck on the consent screen, the code may have aged out before the
     callback ran. Click **Connect Gmail** again.
  3. **`redirect_uri` differs between the auth URL and the token exchange.**
     Donnit reads `GOOGLE_REDIRECT_URI` at call time on each request, so this
     can happen if the env was changed mid-flow (between the user clicking
     Connect Gmail and Google sending them back). Avoid editing
     `GOOGLE_REDIRECT_URI` while users are mid-OAuth.
  4. **Two browser tabs ran the consent flow concurrently.** Each consent
     issues its own code; whichever tab completes the callback first
     consumes the code, and the second tab's redelivered code is rejected.

- **`?gmail=invalid_request`** — Google returned `invalid_request` and the
  description did *not* mention redirect_uri. The token request body was
  rejected as malformed or missing a required parameter. The body Donnit
  sends is `application/x-www-form-urlencoded` with `code`, `client_id`,
  `client_secret`, `redirect_uri`, `grant_type=authorization_code`. If you
  see this reason, read `googleErrorDescription` in the log line — it names
  the offending field.

- **`?gmail=token_exchange_failed`** — generic fallback when Google's response
  did not match any of the above. The toast now appends `(Google: <error> —
  <error_description>)`; copy that into
  [Google's OAuth 2.0 error reference](https://developers.google.com/identity/protocols/oauth2/web-server#exchange-authorization-code).
  If `googleError` is empty (Google returned a non-JSON or empty body),
  check the `status` field — a 5xx implies a transient Google outage; retry.

In every case, the user can recover by clicking **Connect Gmail** again — but
fix the underlying server config first or the next consent will fail the same
way.

#### Full operator checklist (all paths)

When the toast says **Gmail token exchange failed** and you cannot tell which
reason applies, run this checklist top-to-bottom:

1. Open the Vercel function log for the deployed environment and grep for
   `[donnit] gmail token exchange failed`. Note `googleError`,
   `googleErrorDescription`, `status`, `reason`, `redirectUri`.
2. Open `https://<deployed-host>/api/health`. Confirm
   `env.googleClientId`, `env.googleClientSecret`, `env.googleRedirectUri`
   are all `true`.
3. APIs & Services → Credentials → open the OAuth client referenced by
   `GOOGLE_CLIENT_ID`. Confirm:
   - **Application type** is `Web application`.
   - **Authorized redirect URIs** contains the value logged as `redirectUri`,
     **byte-for-byte**. No trailing slash. No query string. No fragment.
4. Compare `GOOGLE_REDIRECT_URI` env var on Vercel with the `redirectUri`
   in the log line. They should be identical. If you have multiple Vercel
   environments (Production, Preview, Development), set the env var on
   each one that serves traffic — Vercel's "Apply to all environments" is
   not the default.
5. Reset and re-paste `GOOGLE_CLIENT_SECRET` (do NOT trust copy/paste —
   verify length matches Google's display, or re-type it). Save and redeploy.
6. After any env change you MUST redeploy: env edits are not picked up by
   already-running functions on Vercel.
7. Trigger a fresh **Connect Gmail** click from a clean browser tab (no
   back-button, no refresh on the consent screen).

### `Gmail API call failed` (toast after clicking Scan email)

The user is connected (the OAuth row exists in `donnit.gmail_accounts` and the
access token refreshes cleanly), but `POST /api/integrations/gmail/scan`'s call
to `https://gmail.googleapis.com/gmail/v1/users/me/messages` was rejected by
Google. Donnit now parses Google's error envelope and routes each failure to a
typed reason; the UI shows the matching toast and the Vercel function log
prints a single sanitized line:

```
[donnit] gmail api error: {
  "httpStatus": 403,
  "googleStatus": "PERMISSION_DENIED",
  "googleReason": "accessNotConfigured",
  "googleDomain": "usageLimits",
  "googleMessage": "Gmail API has not been used in project ... before or it is disabled.",
  "mappedReason": "gmail_api_not_enabled"
}
```

Tokens, full bodies, and request URLs with credentials are NEVER logged — only
the structured envelope above.

#### Triage by typed reason

- **`gmail_api_not_enabled`** (toast: *Enable Gmail API in Google Cloud*) —
  Google returned `accessNotConfigured` / `serviceDisabled`, or the message
  literally says "Gmail API has not been used in project …". The OAuth client
  was created in a Google Cloud project where the Gmail API library has never
  been enabled. Fix: open
  <https://console.cloud.google.com/> → select the project tied to
  `GOOGLE_CLIENT_ID` → **APIs & Services → Library** → search **Gmail API** →
  click **Enable**. Wait ~1 minute for propagation, redeploy if your platform
  caches build outputs, then click **Scan email** again. No reconnect needed —
  the existing OAuth token will start working as soon as the API is enabled
  on the project that issued it.

- **`gmail_scope_missing`** (toast: *Reconnect Gmail with read access*) —
  Google returned `insufficientPermissions` / `insufficientScopes` or the
  message mentions a missing scope. The user authorized Donnit but did not
  grant `https://www.googleapis.com/auth/gmail.readonly` (often because they
  unchecked the "Read your email" box on Google's granular-consent screen).
  Fix: click **Disconnect Gmail**, then **Connect Gmail**, and on Google's
  consent screen leave **all** Donnit permissions checked. The granular
  consent screen lets users opt out of individual scopes — when that happens
  the scan path always 403s.

- **`gmail_reconnect_required`** (toast: *Reconnect Gmail*) — Google returned
  401 / `UNAUTHENTICATED`. The access token is rejected and the refresh
  attempt either failed or wasn't possible. Click **Reconnect Gmail**. If this
  recurs, check that the user hasn't revoked Donnit at
  <https://myaccount.google.com/permissions>.

- **`gmail_api_forbidden`** (toast: *Gmail API access denied*) — Google
  returned 403 / `PERMISSION_DENIED` and the reason did NOT match any of the
  more specific cases above. Common causes:
  - The OAuth client and the project where Gmail API is enabled are
    **different Google Cloud projects**. The `client_id` carries the project,
    so enabling Gmail API in project B doesn't help if `GOOGLE_CLIENT_ID`
    points at project A. Either enable Gmail API in project A, or rotate
    `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` to a client created in project B.
  - The consenting Google account is in a Workspace org that disallows
    third-party app access to Gmail. The Workspace admin must allowlist the
    app or relax the policy.

- **`gmail_rate_limited`** (toast: *Gmail API rate limit hit*) — Google
  returned 429 or `rateLimitExceeded` / `quotaExceeded`. Wait a minute and
  retry. If this is sustained, check the Gmail API quota in the Google Cloud
  Console for the project.

- **`gmail_api_unavailable`** (toast: *Gmail API temporarily unavailable*) —
  Google returned 502/503/504. Transient Google outage; retry shortly. Check
  <https://www.google.com/appsstatus/> if it persists.

- **`gmail_api_bad_request`** (toast: *Gmail API rejected the request*) —
  Google returned 400 / `INVALID_ARGUMENT`. This is a Donnit bug (a malformed
  query string or message id). File an issue with the `googleMessage` from
  the log line.

- **`gmail_api_call_failed`** (toast: *Email scan unavailable*) — generic
  fallback when none of the above matched. Look at the log line's
  `httpStatus`, `googleStatus`, and `googleMessage` fields and compare against
  Google's [Gmail API error reference](https://developers.google.com/gmail/api/guides/handle-errors).

#### Quick checks

1. **Is Gmail API enabled in the right project?** Open the Google Cloud
   Console and switch to the project whose Credentials list contains
   `GOOGLE_CLIENT_ID`. **APIs & Services → Enabled APIs & services** must list
   **Gmail API**. If not, **APIs & Services → Library → Gmail API → Enable**.
2. **Did the user grant the read scope?** On Google's consent screen there is
   a checkbox per requested permission; if the user unchecked "Read, compose,
   send, and permanently delete all your email from Gmail" the scope is not
   granted. Reconnect and accept the read permission.
3. **Is the OAuth client still in the same project as the enabled Gmail API?**
   Compare the **Project** column of the Credentials list against the project
   where Gmail API is enabled.

## Operational notes

- Refresh tokens are issued only on the **first** consent that includes
  `prompt=consent`. The `connect` route always passes `prompt=consent` so the
  refresh token is reliably re-issued on reconnect.
- Tokens are refreshed automatically inside `POST /api/integrations/gmail/scan`
  when the stored access token is within 30 seconds of expiry.
- Disconnecting deletes the row in `donnit.gmail_accounts`. The Google grant
  itself remains until the user revokes it at
  <https://myaccount.google.com/permissions>; instruct testers accordingly.
- The connector path remains as a fallback. If both the connector and OAuth
  fail, the UI surfaces a friendly message; it does NOT auto-open the manual
  paste dialog (manual paste is a diagnostic, not a product behavior).
