export class RulesetLoadError extends Error {
  constructor(
    public readonly code: "FILE_MISSING" | "INVALID_JSON" | "INVALID_MANIFEST" | "FREEZE_SET_MISMATCH" | "HASH_MISMATCH" | "ASSET_WHITELIST_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "RulesetLoadError";
  }
}
