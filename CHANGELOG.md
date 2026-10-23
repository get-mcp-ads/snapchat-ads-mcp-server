# Changelog

## 1.0.0 - 2026-10-23 - First standalone release
- First standalone server, ported from the getmcpads gateway at revision `3e1c2c8`: 21 native read tools, 25 native write tools and the `snapchat://guide` and `snapchat://reporting-fields` resources.
- Require `SNAPCHAT_ADS_ACCOUNT_IDS` and check every request and every referenced entity against the selected ad account.
- Keep writes off unless `SNAPCHAT_ADS_ENABLE_WRITES` is exactly `true`. Every write previews until `confirm: true`, and campaigns, ad squads and ads are created paused.
- Renew the access token in memory from the refresh credentials, without writing it anywhere, and redact credentials from every error.
- Reach only `adsapi.snapchat.com` and `accounts.snapchat.com`, with no redirect followed, timeouts and a 16 MB response bound.
- Report HTTP 200 replies that carry a failed request or failed items as errors, and an explicit single-create rejection as not applied.
- Leave out the hosted frozen-file uploads, creative gallery UI, alerts and Launcher.
- Require Node.js 22.23.4, 24.22.1, 26.12.1 or newer in those lines, warn on stderr otherwise, and test Node 22, 24 and 26 in CI.
