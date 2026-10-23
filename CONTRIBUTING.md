# Contributing

Thanks for considering a contribution. This project is maintained by
[GetMCPAds](https://www.getmcpads.com) and is open to outside patches.

## Getting set up

```bash
git clone https://github.com/get-mcp-ads/snapchat-ads-mcp-server.git
cd snapchat-ads-mcp-server
npm install
cp .env.example .env
```

Then run the checks:

```bash
npm run typecheck && npm run lint && npm run build && npm test
```

All four must pass. CI runs them on Node 22, 24 and 26. The tests read the
build output, so build before testing.

## Ground rules

**Never commit a credential.** `.env` is gitignored. Before opening a PR,
re-read your diff for access tokens, refresh tokens and client secrets.

**Tests use synthetic data.** Every test mocks `fetch`. Do not add a test that
needs live credentials to pass; CI has none.

**Native field names are the load-bearing part.** Write tools accept Snap's own
field names, and `snapchat_get_write_schema` lists the ones this server accepts.
If you add or change one, say in the PR description where it comes from: a link
to the Snap documentation, or the API error you observed.

**Write tools must preview first.** Any new write tool has to accept `confirm`
and return a preview unless it is `true`. Campaigns, ad squads and ads are
created paused. A tool that mutates an account on the first call, or that
retries a write whose outcome is uncertain, will not be merged.

**Keep the account checks.** Every tool that takes `adAccountId` is checked
against `SNAPCHAT_ADS_ACCOUNT_IDS`, and every entity it touches is checked
against that account. Do not relax either without saying why in the PR.

**Keep it self-contained.** Runtime dependencies are `@modelcontextprotocol/sdk`
and `zod`. Adding a third needs a good reason.

## Credentials never reach the logs or another host

Two tests enforce this: one fails if any `fetch` omits `redirect: "error"`, and
one fails if a host other than `adsapi.snapchat.com` and `accounts.snapchat.com`
appears in the source. Hosts live in `src/platforms/snapchat/hosts.ts`.

## Documentation

The README lists every tool and resource, and a test checks the list and the
counts against the server. Run `npm run catalog` after changing a tool, so
`server-card.json` follows.

## Commit and PR style

- One logical change per PR.
- Explain *why*, not just *what*. The diff already says what.
- If you fix a bug, add the test that would have caught it.

## Reporting bugs

Open an issue with: what you called, what you expected, what you got, and the
Snap `request_id` when there is one. Redact IDs and tokens.

For anything security-related, do not open an issue. See [SECURITY.md](SECURITY.md).

## Licence

By contributing, you agree that your contributions are licensed under the
Apache License 2.0, as stated in [LICENSE](LICENSE).
