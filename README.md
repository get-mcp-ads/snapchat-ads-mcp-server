<div align="center">

# Snapchat Ads MCP server

### Bring your Snapchat Ads accounts into your MCP client.

Read campaigns and performance, and prepare changes for the ad accounts you select.

[![Release](https://img.shields.io/github/v/release/get-mcp-ads/snapchat-ads-mcp-server?color=2448e5)](https://github.com/get-mcp-ads/snapchat-ads-mcp-server/releases/latest)
[![CI](https://github.com/get-mcp-ads/snapchat-ads-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/get-mcp-ads/snapchat-ads-mcp-server/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-22.23.4%2B%20%7C%2024.22.1%2B%20%7C%2026.12.1%2B-brightgreen.svg)](package.json)

[Watch the film](https://www.getmcpads.com/home/film/get-mcp-ads-brand-film-1080p.mp4) · [What's new](#whats-new) · [Install](#install-this-release) · [Tool reference](#tools) · [Try hosted getmcpads](https://www.getmcpads.com/tools/snapchat-ads?utm_source=github&utm_medium=readme&utm_campaign=snapchat-ads)

[![Watch the getmcpads film: every ad account in one conversation with your AI assistant](https://www.getmcpads.com/home/film/brand-film-poster-promise.webp)](https://www.getmcpads.com/home/film/get-mcp-ads-brand-film-1080p.mp4)

**[Play the 45-second film](https://www.getmcpads.com/home/film/get-mcp-ads-brand-film-1080p.mp4)**

</div>

The film shows hosted getmcpads with sample data. Its MCP Apps, from creative galleries and alerts to Google Sheets exports and bulk launches, belong to the hosted product. This repository provides the standalone native API tools.

**21 read tools** · **25 write tools**, disabled by default.

Run locally with your own Snap Marketing API credentials and a client that supports stdio MCP, such as Claude Desktop, Claude Code or Cursor. Your requests go directly to Snap. For managed connections, including supported ChatGPT setups, use the hosted option.

## What's new

<!-- release-history:start -->
**[v1.0.1: Zod 4 security update](https://github.com/get-mcp-ads/snapchat-ads-mcp-server/releases/tag/v1.0.1) · October 26, 2026**

- Update `zod` to 4.6.7. Every Zod release before 4.6.6 is covered by the high-severity advisory GHSA-mrhx-c7xc-m3w5: validating an oversized constrained collection can exhaust memory, and no Zod 3 release carries the fix. `npm audit --omit=dev` reports no vulnerability again.
- Keep the Zod 3 validation behaviour. A parameter default is still validated and completed before use, so an omitted object must still supply its required fields.
- Keep each parameter's own description when the parameter is optional or has a default. Zod 4 stores a description on the wrapped schema only, so the shared fallback description could otherwise replace it.
- Tool names, parameters and descriptions published over MCP are unchanged. `server-card.json` is regenerated with Zod 4's JSON Schema output, which spells some constraints differently.

**Earlier releases**

| Version | Date | Highlights |
| --- | --- | --- |
| 1.0.0 | October 23, 2026 | First standalone release |

[Full changelog](CHANGELOG.md) · [All releases](https://github.com/get-mcp-ads/snapchat-ads-mcp-server/releases)
<!-- release-history:end -->

Source synchronization: [SOURCE_SYNC.md](SOURCE_SYNC.md).

### Upgrade notes

Requires **Node.js 22.23.4, 24.22.1, 26.12.1 or a newer release of those lines**. These releases carry the October 2026 security fixes, and the server prints a warning on stderr when it runs on an older one. CI covers Node 22, 24 and 26. Writes remain optional and require explicit confirmation. Hosted creative integrations and MCP Apps UI are outside this release.

## Install this release

This is a GitHub source release. npm and MCP Registry versions are published separately. The commands below select this exact version; unpinned `npx` examples later in this document select the version currently available on npm.

```bash
git clone --branch v1.0.1 --depth 1 https://github.com/get-mcp-ads/snapchat-ads-mcp-server.git
cd snapchat-ads-mcp-server
npm ci
npm run build
```

Configure your MCP client to run `node` with the absolute path to `dist/cli.js` and the environment variables documented below.

> **Managed connection.** [Use Snapchat Ads with hosted getmcpads](https://www.getmcpads.com/tools/snapchat-ads?utm_source=github&utm_medium=readme&utm_campaign=snapchat-ads). Connect your account, select the data your assistant may access and use the hosted MCP connection. See the site for current features and plans.

## Configuration

Provide these environment variables through the client's secret configuration:

| Variable | Purpose |
|---|---|
| `SNAPCHAT_ADS_ACCOUNT_IDS` | Required. Comma-separated ad account UUIDs this server may use. Requests for any other account are refused before they leave your machine. Organization IDs are not ad account IDs. |
| `SNAPCHAT_ADS_REFRESH_TOKEN` | Refresh token from your own Snap Marketing API OAuth app. With the two variables below, the server renews the access token in memory. |
| `SNAPCHAT_ADS_CLIENT_ID` | Client ID of that OAuth app. |
| `SNAPCHAT_ADS_CLIENT_SECRET` | Client secret of that OAuth app. |
| `SNAPCHAT_ADS_ACCESS_TOKEN` | Optional access token. Alone, it lasts until Snap expires it, after an hour. With the refresh credentials, it is used first. |
| `SNAPCHAT_ADS_ENABLE_WRITES` | Defaults to `false`. Only the exact value `true` exposes the write tools. Any other value stops the server at startup. |

Set either `SNAPCHAT_ADS_ACCESS_TOKEN` or the three refresh variables together. The server validates the configuration at startup and names the variable to fix, without repeating any value.

To obtain credentials, create an OAuth app for the Snap Marketing API, authorize it once with the `snapchat-marketing-api` scope, and exchange the authorization code for a refresh token, as described in [Snap's authentication guide](https://developers.snap.com/api/marketing-api/Ads-API/authentication). This package does not run an OAuth browser flow. It keeps renewed tokens in memory only, so a restart begins again from the refresh token you configured.

Example client entry, once the package is on npm:

```json
{
  "mcpServers": {
    "snapchat-ads": {
      "command": "npx",
      "args": ["-y", "@getmcpads/snapchat-ads-mcp-server"],
      "env": {
        "SNAPCHAT_ADS_ACCOUNT_IDS": "your-ad-account-uuid",
        "SNAPCHAT_ADS_REFRESH_TOKEN": "your-refresh-token",
        "SNAPCHAT_ADS_CLIENT_ID": "your-client-id",
        "SNAPCHAT_ADS_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

`npm run doctor` reports which variables are present, never their values, and whether your Node.js release carries the October 2026 security fixes.

## Safety and coverage

Writes preview by default. Review the exact account, target and parameters before repeating the call with `confirm: true`.
Campaigns, ad squads and ads are created paused. Activation through `snapchat_update_status` can spend advertising budget, and its preview says so.
A write whose outcome is uncertain is never retried. A timeout, a network failure, a server error or an unreadable reply after a write is reported as unknown: read the entity and reconcile it first. A successful write is followed by an account-scoped readback, and the receipt is kept even when that readback fails.
Before any write, the parent and every referenced pixel, app, audience, media, creative and lead form are read and checked against the selected ad account. Unknown arguments are rejected.
Snap can answer HTTP 200 with a failed `request_status` or failed items. Both are reported as errors. An explicit single-create validation rejection is reported with `applied: false`.
Monetary fields ending in `_micro`, `spend` and monetary conversion values are micro currency: 1,000,000 equals one unit of the account currency. List tools return `next_cursor` for the next page, and insights flag `partial: true` when Snap returned another page.
Snap documents about 20 requests per second per app and 10 per second per access token. An HTTP 429 is reported with an instruction to wait.

Requests go only to `adsapi.snapchat.com` and to `accounts.snapchat.com` for token renewal. No request follows a redirect, every request has a timeout, and replies are capped at 16 MB. Media links that Snap returns are passed through as data and never downloaded. Tokens are redacted from every error.

Uploads take base64 bytes: 5 MB per image and 10 MiB per direct video, or up to 256 MiB of video through the multipart tools in parts of 8 MiB. Follow every upload with `snapchat_get_media_status` until `ready` is true. The gateway's four frozen-file upload tools read files from the hosted Launcher storage, so they are not part of this server. The gateway's native upload takes bytes and fetches no URL, so this server adds no local-file or URL upload either.

This server exposes a reviewed subset of the Snap Marketing API. Use `tools/list` or [server-card.json](server-card.json) for exact schemas, the `snapchat://guide` and `snapchat://reporting-fields` resources for units and curated reporting fields, and [the official API reference](https://developers.snap.com/api/marketing-api/Ads-API/introduction) for provider details.

### Snap's official Ads MCP server

Snap documents its own [Snapchat Ads MCP server](https://developers.snap.com/marketing-api/Ads-MCP/Introduction). The comparison below uses only Snap's [introduction](https://developers.snap.com/marketing-api/Ads-MCP/Introduction) and [connection guide](https://developers.snap.com/marketing-api/Ads-MCP/connect-an-agent), read on October 23, 2026.

| | Snap's Ads MCP server | This server |
|---|---|---|
| Where it runs | A remote endpoint, `https://mcp.snapchat.com/ads`, reached over HTTP | On your machine, over stdio |
| Access | Read-only: an agent cannot create, update or delete anything. Snap plans write access for a future release. | 21 read tools, and 25 write tools when you enable them |
| Authorization | OAuth with a client ID that Snap registered for each supported agent. An organization admin approves the agent, then each member authorizes. | Your own Snap Marketing API OAuth app, configured through environment variables |
| Account scope | The organizations and ad accounts that the member's Snapchat Ads permissions allow | Only the ad accounts in `SNAPCHAT_ADS_ACCOUNT_IDS` |

## Hosted option

[getmcpads for Snapchat Ads](https://www.getmcpads.com/tools/snapchat-ads?utm_source=github&utm_medium=readme&utm_campaign=snapchat-ads) manages the hosted connection and account selection.
Hosted and source releases can differ. Contact: hello@getmcpads.com.

## Development

```bash
npm run typecheck
npm run lint
npm run build
npm test
npm run catalog
```

All tests run offline with synthetic responses and a mocked `fetch`. No live account is read or changed.

## Tools

Every tool is listed below. See [server-card.json](server-card.json) for complete parameter and output schemas. An ad squad is Snap's ad group.

<details>
<summary><b>21 read tools</b></summary>

| Tool | Purpose |
| --- | --- |
| `snapchat_health_check` | Read the selected ad account, its timezone, currency and test flag. Test accounts cannot serve ads. |
| `snapchat_get_campaigns` | List campaigns in the selected account, with native configuration and pagination. |
| `snapchat_get_adsquads` | List ad squads in the selected account. |
| `snapchat_get_ads` | List ads in the selected account. |
| `snapchat_get_creatives` | List creatives in the selected account. |
| `snapchat_get_media` | List media in the selected account. |
| `snapchat_get_segments` | List audience segments in the selected account. |
| `snapchat_get_creative_elements` | List creative elements, the tiles of Collection ads. |
| `snapchat_get_interaction_zones` | List interaction zones of Collection ads. |
| `snapchat_get_lead_generation_forms` | List lead generation forms. |
| `snapchat_get_media_status` | Read one media object and its processing state. Only `ready: true` permits creative creation. |
| `snapchat_list_ad_creatives` | Resolve the images and videos behind ads, including Story children and Collection tiles, with fresh media links. |
| `snapchat_get_targeting` | Read configured ad squad targeting, audiences, exclusions, geo and placements. |
| `snapchat_get_entity` | Read one campaign, ad squad, ad, creative, media, segment, creative element, interaction zone or lead form, with verified ownership. |
| `snapchat_get_write_schema` | Describe the fields this server accepts for each creation and edit, and the required ones. |
| `snapchat_get_insights` | Read native stats for an interval, with granularity, entity breakdown and an optional delivery pivot. |
| `snapchat_get_mobile_apps` | Read the Snap App IDs associated with the account. |
| `snapchat_get_pixels` | Read the pixels associated with the account. |
| `snapchat_get_targeting_specs` | Read separately stored targeting specs, including those above 500 criteria. |
| `snapchat_get_targeting_options` | Discover native targeting values: countries, regions, metros, postal codes, languages, genders, age groups, interests and devices. |
| `snapchat_get_setup_guide` | Read objectives, audience workflows, format prerequisites and the limits of this server. |

</details>

<details>
<summary><b>25 write tools</b></summary>

Disabled by default. Calls preview unless explicitly confirmed. Check the configuration and exact schema before use.

| Tool | Purpose |
| --- | --- |
| `snapchat_create_campaign` | Create a campaign, always paused. |
| `snapchat_update_campaign` | Update campaign configuration. |
| `snapchat_create_adsquad` | Create an ad squad under a campaign, always paused. |
| `snapchat_update_adsquad` | Update ad squad targeting, schedule, budget and other configuration. |
| `snapchat_create_ad` | Create an ad under an ad squad, always paused. |
| `snapchat_update_ad` | Update ad configuration. |
| `snapchat_create_creative` | Create a creative, after checking its media, public profile and call to action. |
| `snapchat_update_creative` | Update creative configuration. |
| `snapchat_create_media` | Create a media object to upload into. |
| `snapchat_create_segment` | Create an audience segment: customer list, pixel, mobile or engagement audience. |
| `snapchat_create_creative_element` | Create a creative element for a Collection ad. |
| `snapchat_create_interaction_zone` | Create an interaction zone from creative elements. |
| `snapchat_create_lead_generation_form` | Create a lead generation form. |
| `snapchat_rename_campaign` | Rename one campaign. Only the name changes. |
| `snapchat_rename_adsquad` | Rename one ad squad. Only the name changes. |
| `snapchat_rename_ad` | Rename one ad. Only the name changes. |
| `snapchat_rename_ad_account` | Rename the ad account by writing it back as read, with the new name. |
| `snapchat_update_status` | Pause or activate a campaign, ad squad or ad. Activation can spend budget. |
| `snapchat_upload_media` | Upload base64 image or video bytes into a media object. |
| `snapchat_update_segment` | Rename an audience segment or change its description or retention. |
| `snapchat_update_audience_users` | Add or remove customer-list members as normalized SHA-256 hashes. |
| `snapchat_create_lookalike` | Create a lookalike audience from an owned customer list. |
| `snapchat_init_media_upload` | Start a multipart video upload of up to 256 MiB. |
| `snapchat_upload_media_part` | Upload one part of a multipart video upload. |
| `snapchat_finalize_media_upload` | Finalize a multipart video upload. |

</details>

## Resources

| Resource | Content |
| --- | --- |
| `snapchat://guide` | Units, pagination, write safety, upload limits and rate limits. |
| `snapchat://reporting-fields` | Curated stats fields and breakdowns for `snapchat_get_insights`. |

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE).

## More from getmcpads

[Meta Ads](https://github.com/get-mcp-ads/meta-ads-mcp-server) · [Google Ads](https://github.com/get-mcp-ads/google-ads-mcp-server) · [Google Analytics 4](https://github.com/get-mcp-ads/google-analytics-mcp-server) · [Google Search Console](https://github.com/get-mcp-ads/google-search-console-mcp-server) · [TikTok Ads](https://github.com/get-mcp-ads/tiktok-ads-mcp-server) · [Pinterest Ads](https://github.com/get-mcp-ads/pinterest-ads-mcp-server) · [X Ads](https://github.com/get-mcp-ads/x-ads-mcp-server)

Maintained by **Emmanuel** at [getmcpads](https://www.getmcpads.com). Questions: [hello@getmcpads.com](mailto:hello@getmcpads.com).
