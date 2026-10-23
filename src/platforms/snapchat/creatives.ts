/**
 * Resolve the images and videos behind ads, through Story children and
 * Collection tiles, with every read scoped to the selected ad account.
 * Media links are returned as data: this server never downloads them.
 * Copyright 2026 GetMCPAds. SPDX-License-Identifier: Apache-2.0
 */
import { SnapClient, type Row } from "./client.js";

const MAX_ASSETS = 120;

/** A static thumbnail is never presented as an interactive Lens. */
export async function snapCreativeAssets(api: SnapClient, account: string, ads: Row[]) {
  const assets: Row[] = [];
  const warnings: string[] = [];
  const cache = new Map<string, Promise<Row>>();
  const entity = (kind: string, id: string) => {
    const key = kind + ":" + id;
    if (!cache.has(key)) cache.set(key, api.entity(kind, id, account));
    return cache.get(key)!;
  };
  for (const ad of ads) {
    const seen = new Set<string>();
    const mediaRefs = new Map<string, Row>();
    async function visit(creative: Row, depth: number): Promise<void> {
      if (seen.has(creative.id)) return;
      seen.add(creative.id);
      if (depth > 2 || seen.size > 24) {
        warnings.push(`Ad ${ad.id}: creative component traversal truncated.`);
        return;
      }
      if (creative.top_snap_media_id) mediaRefs.set(creative.top_snap_media_id, creative);
      if (creative.preview_properties?.preview_media_id) mediaRefs.set(creative.preview_properties.preview_media_id, creative);
      for (const cid of (creative.composite_properties?.creative_ids ?? []).slice(0, 20))
        await visit(await entity("creative", cid), depth + 1);
      if (creative.preview_creative_id) await visit(await entity("creative", creative.preview_creative_id), depth + 1);
      if (creative.collection_properties?.interaction_zone_id) {
        const zone = await entity("interaction_zone", creative.collection_properties.interaction_zone_id);
        for (const eid of (zone.creative_element_ids ?? []).slice(0, 20)) {
          const element = await entity("creative_element", eid);
          const mid = element.button_properties?.button_overlay_media_id;
          if (mid) mediaRefs.set(mid, element);
        }
      }
    }
    try {
      const creative = await entity("creative", ad.creative_id);
      await visit(creative, 0);
      if (!mediaRefs.size)
        warnings.push(`Ad ${ad.id}: ${creative.type} has no resolvable static image/video. Lens and dynamic rendering may require native preview.`);
      for (const [mid, component] of mediaRefs) {
        if (assets.length >= MAX_ASSETS) {
          warnings.push(`Asset list truncated at ${MAX_ASSETS} media.`);
          return { assets, warnings };
        }
        try {
          const media = await entity("media", mid);
          if (!["IMAGE", "VIDEO"].includes(media.type)) {
            warnings.push(`Ad ${ad.id}: media ${mid} has unsupported render type ${media.type}.`);
            continue;
          }
          const video = media.type === "VIDEO";
          const link = media.download_link ?? (await api.request(`/media/${mid}/preview`)).link;
          const thumbnail = video ? (await api.request(`/media/${mid}/thumbnail`)).link : link;
          assets.push({
            id: `${ad.id}/${mid}`,
            nativeAssetId: mid,
            kind: video ? "video" : "image",
            name: ad.name,
            assetName: media.name,
            mediaStatus: media.media_status,
            creativeId: component.id,
            relatedAds: [{ id: ad.id, name: ad.name }],
            thumbnail,
            link,
            landingPageUrl: component.web_view_properties?.url,
          });
        } catch (e) {
          warnings.push(`Ad ${ad.id}, media ${mid}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } catch (e) {
      warnings.push(`Ad ${ad.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { assets, warnings };
}
