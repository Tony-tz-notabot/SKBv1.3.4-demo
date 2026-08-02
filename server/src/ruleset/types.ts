export interface RulesetManifest {
  rulesetId: string;
  version: string;
  status: "frozen_baseline";
  generatedBy: string;
  sources: Record<string, string>;
  files: Record<string, string>;
}

export interface FreezeEntry {
  filename: string;
  sha256: string;
}

export interface RulesetFreeze {
  rulesetId: string;
  version: string;
  status: "frozen_baseline";
  hashAlgorithm: "sha256";
  files: FreezeEntry[];
  allowedMissingSpecificAssets: string[];
}

export interface RulesetSettings {
  rulesetVersion: string;
  players: number;
  teamsBySeat: Record<string, "A" | "B">;
  turnDirection: "counterclockwise";
  defaultDrawCount: number;
  defaultAttackCount: number;
  cardColorRank: Record<"white" | "green" | "blue" | "orange" | "red", number>;
  special: { sp10: { flavorLines: string[] } };
  character: {
    traveler: {
      deadlyCurse: {
        minimumOwnedCardCount: number;
        offFieldOwnTurnsUntilReturn: number;
        returnHp: number;
        returnShield: number;
        returnDrawCount: number;
        executionTargetHp: number;
        executionTargetShield: number;
        executionTargetHealthFloor: number;
      };
    };
  };
  engine: { autoAdvanceMaxSteps: number };
  combat: {
    handKnife: {
      range: number;
      damage: number;
      attackType: "melee";
      killCards: number;
      attackCount: number;
    };
    killTemplatePrefix: string;
    attackCountLimitId: string;
  };
  setup: {
    initialHandCount: number;
    redraw: {
      enabled: boolean;
      maxUsesPerPlayer: number;
      discardAll: boolean;
      drawCount: number;
      timeoutMs: number;
      timeoutPolicy: "pass";
    };
  };
  boss: { allowGenericDismantle: boolean };
  timeout: {
    optionalOrBeneficial: "pass";
    forcedOrHarmful: "random_legal";
  };
}

export interface LoadedRuleset {
  readonly directory: string;
  readonly manifest: Readonly<RulesetManifest>;
  readonly freeze: Readonly<RulesetFreeze>;
  readonly settings: Readonly<RulesetSettings>;
  readonly documents: ReadonlyMap<string, unknown>;
}
