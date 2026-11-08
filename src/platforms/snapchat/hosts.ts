/**
 * Every host this server can contact, in one place. Adding a host is a
 * deliberate decision: test/redirect-guard.test.mjs fails when another one
 * appears anywhere in src/.
 * Copyright 2026 GetMCPAds. SPDX-License-Identifier: Apache-2.0
 */

/** Snapchat Marketing API. Regional multipart upload paths live on this origin too. */
export const SNAP_API_ORIGIN = "https://adsapi.snapchat.com";
export const SNAP_API_BASE = `${SNAP_API_ORIGIN}/v1`;

/** OAuth token endpoint, used only to renew the access token in memory. */
export const SNAP_TOKEN_URL = "https://accounts.snapchat.com/login/oauth2/access_token";

/** Documentation links returned in tool results. This server never fetches them. */
export const SNAP_DOCS = "https://developers.snap.com/api/marketing-api/Ads-API";
