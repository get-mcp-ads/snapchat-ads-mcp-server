/** Descriptions shared by equivalent parameters; explicit tool descriptions always win. */
export const PARAMETER_DESCRIPTIONS: Record<string, string> = {
  adAccountId: "Snapchat ad account UUID listed in SNAPCHAT_ADS_ACCOUNT_IDS; never an organization ID.",
  limit: "Maximum number of returned items. The declared bounds and default apply; use pagination for additional results.",
  cursor: "Opaque cursor from the previous response's next_cursor. Omit on the first request.",
  confirm: "False previews only. True applies the previewed change, after the user approved it.",
  spec: "Native Snap fields for this entity. Call snapchat_get_write_schema first.",
  entityId: "Native Snapchat entity ID belonging to the selected ad account.",
  segmentId: "Native audience segment ID (UUID or numeric string).",
  name: "Display name.",
};
