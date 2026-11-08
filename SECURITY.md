# Security Policy

This server holds credentials that can read, and when writes are enabled
modify, live Snapchat advertising accounts. We take reports seriously.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting on this repository:
[Report a vulnerability](https://github.com/get-mcp-ads/snapchat-ads-mcp-server/security/advisories/new).

We aim to acknowledge a report within 3 business days and to ship a fix or a
documented mitigation within 30 days. We will credit you in the advisory unless
you ask us not to.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |

Run it on Node.js 22.23.4, 24.22.1, 26.12.1 or a newer release of those lines.
Older releases lack the October 2026 security fixes, among them a remote code
execution in the Brotli decoder that `fetch` uses for compressed replies. The
server prints a warning on stderr when it starts on such a release.

## What this server does with your credentials

- The access token and the refresh credentials are read once from the
  environment at startup and kept in memory. A renewed access token stays in
  memory too. None is written to disk, logged or returned in a tool result.
- Tokens and the client secret are redacted from every error message, including
  text that Snap echoes back.
- **Two hosts are contacted, and only two**: `adsapi.snapchat.com` for the
  Marketing API and `accounts.snapchat.com` for token renewal. Both are declared
  in `src/platforms/snapchat/hosts.ts`. *A test fails the build if another host
  appears in the source.*
- **No fetch follows a redirect.** Every outbound call sets `redirect: "error"`,
  so a redirect cannot forward your token to another host. *A test fails the
  build if any fetch omits this.*
- Every request has a timeout, and replies are capped at 16 MB.
- No telemetry, no analytics, no phone-home.

## Account scope

`SNAPCHAT_ADS_ACCOUNT_IDS` is required. A request for any other ad account is
refused before it leaves the machine, both where a tool reads its arguments and
in the client for any `/adaccounts/{id}` path. Every entity a tool reads or
references (campaign, ad squad, ad, creative, media, audience, pixel, app, lead
form) is checked against the selected ad account before it is used.

## Data returned by Snap

- Media links in `snapchat_list_ad_creatives` results are short-lived URLs
  chosen by Snap. They are passed through as data and this server never
  downloads them.
- Multipart upload paths returned by Snap are accepted only when they match the
  exact media ID and action, on the Snap API host.
- Entity IDs read from a Snap reply are validated before they become part of a
  request path, and `paging.next_link` is parsed for its cursor only when it
  points at the Snap API.

## Personal data

`snapchat_update_audience_users` accepts only normalized SHA-256 hashes, never
raw emails, phone numbers or mobile IDs, and its preview reports a count, not
the hashes.

## Handling your credentials safely

- Prefer the refresh credentials of your own OAuth app over a long-lived copy
  of an access token, and keep the client secret out of shared files.
- Leave writes disabled unless you need them.
- Your MCP client config file is usually plain text on disk. Check its
  permissions, and never commit it.
- Rotate the client secret and authorize the app again if you suspect
  exposure.

## Scope

Vulnerabilities in the Snap Marketing API itself are not in scope here; report
those to Snap.
