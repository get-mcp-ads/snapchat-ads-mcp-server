/**
 * Curated reporting fields, not an exhaustive claim about the provider API.
 * Copyright 2026 GetMCPAds. SPDX-License-Identifier: Apache-2.0
 */
const monetary = (key: string) => key === "spend" || key.endsWith("_value");

export const SNAP_METRICS = [
  "spend",
  "impressions",
  "swipes",
  "video_views",
  "quartile_1",
  "quartile_2",
  "quartile_3",
  "view_completion",
  "conversion_purchases",
  "conversion_purchases_value",
  "conversion_add_cart",
  "conversion_sign_ups",
].map((key) => ({
  key,
  name: key.replaceAll("_", " "),
  description: monetary(key)
    ? "Native monetary value in micro currency (divide by 1,000,000)."
    : "Native Snapchat reporting count; availability depends on level and breakdown.",
  apiField: key,
  format: monetary(key) ? "micro_currency" : "number",
}));

export const SNAP_DIMENSIONS = [
  "ad",
  "adsquad",
  "campaign",
  "age",
  "gender",
  "country",
  "region",
  "dma",
  "os",
  "lifestyle_category",
].map((key) => ({
  key,
  name: key.replaceAll("_", " "),
  description: ["ad", "adsquad", "campaign"].includes(key)
    ? "Entity breakdown, passed as breakdown. Supported levels vary."
    : "Delivery audience pivot, passed as reportDimension. Describes delivery, not configured targeting.",
  apiField: key,
}));
