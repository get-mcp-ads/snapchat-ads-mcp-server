# Source synchronization

Reviewed on 2026-10-23 against getmcpads gateway revision `3e1c2c8`.

## Synchronized

- Every native Snapchat tool of the gateway except the four frozen-file uploads: 21 reads and 25 writes, with the gateway's names, parameters and write flags.
- `client.ts`: native request handling, HTTP 200 error bodies, per-item `sub_request_status` failures, the explicit single-create rejection (`E1008`, `E2002`, `E2652`) and account-scoped entity reads.
- `validation.ts`: schedule, micro-currency budget, Smart Budgets, interaction zone CTA and creative profile checks, and the readback receipt after every write.
- `catalog.ts`: the curated metrics and dimensions, now served as the `snapchat://reporting-fields` resource.
- `gallery.ts`: the native creative resolution behind `snapchat_list_ad_creatives`, minus the fields used only by the hosted gallery.
- `rename.ts` and `native-receipt.ts`: the rename preview and the receipt comparison.
- The `snapchat://guide` resource, rewritten for a local server.

## Stays hosted

- `frozen-upload.ts` and `crypto.ts`: `snapchat_prepare_frozen_upload`, `snapchat_upload_frozen_part`, `snapchat_finalize_frozen_upload` and `snapchat_upload_frozen_image` read files from the hosted Launcher storage with signed, encrypted receipts. The gateway's native upload takes base64 bytes and fetches no URL, so no local-file or URL upload replaces them. The base64 direct upload and the multipart upload tools cover the same Snap endpoints.
- `alert-catalog.ts`, `report.ts` and `launcher/snapchat.ts`: alerts, hosted report aggregation and Launcher plan checks.
- Billing, plans, workspaces, stored account selection, token storage, client memory, MCP Apps UI, Google Sheets exports and the discovery meta-tools.

## Standalone changes

- Credentials come from `SNAPCHAT_ADS_` environment variables, validated at startup. Renewed tokens stay in memory; the gateway persisted them.
- `SNAPCHAT_ADS_ACCOUNT_IDS` is enforced before every request, in the tool layer and again in the client for any `/adaccounts/{id}` path.
- Every request uses `redirect: "error"`, a timeout and a 16 MB response bound. Entity IDs read from Snap are validated before they enter a path.
- List tools add `next_cursor`, parsed from Snap's `paging.next_link`. Insights add `partial: true` when Snap returned another page.
- `snapchat_list_ad_creatives` reads ads one by one rather than in parallel, to stay within Snap's rate limits.
- Error messages are written for a local user, and an uncertain write outcome says to read the entity before any retry.

Validation uses synthetic data and a mocked `fetch`. No live advertising account is read or changed by the test suite. The generated `server-card.json` is the source of truth for this revision's tool schemas.

Maintainer: Emmanuel, getmcpads. Contact: hello@getmcpads.com.
