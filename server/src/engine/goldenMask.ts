import type { LoadedRuleset } from "../ruleset/types.js";
import { calculateEffectiveDistance } from "./distance.js";
import { beginJudgmentInTransaction, type PrintedColor } from "./judgment.js";
import { createScriptedAttackInTransaction } from "./scriptedAttack.js";
import type { AuthoritativeGameState, Phase, Seat } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent, JsonValue } from "./types.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { expireStatusesAtPhaseAfter } from "./status.js";
import { openC6BombardmentAtPlayAfter } from "./c6h8o6.js";

interface AttackTemplate {
  range: number;
  attackType: string;
  damage: { amount: number; repeat: number };
}
interface GoldenMaskFamily {
  familyId: string;
  phaseReplacement: {
    ownerTurns: number[];
    phases: Phase[];
  };
  attackTemplates: Record<string, AttackTemplate>;
}
interface BossDocument {
  effectFamilies: GoldenMaskFamily[];
}

export const goldenMaskReplacementId = "boss.golden_mask.chaosStrike";

function definition(ruleset: LoadedRuleset): GoldenMaskFamily {
  const family = (
    ruleset.documents.get("boss-rules.json") as BossDocument
  ).effectFamilies.find((item) => item.familyId === "boss.golden_mask");
  if (!family) throw new Error("GOLDEN_MASK_DEFINITION_MISSING");
  return family;
}

export function shouldReplaceWithGoldenMask(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  seat: Seat,
  phase: Phase,
): boolean {
  const ref = state.zones[`boss:${seat}`]?.orderedCardRefs[0],
    card = ref ? state.cards[ref] : undefined;
  if (
    !card ||
    card.templateId !== "boss.golden_mask" ||
    card.runtime.active !== true
  )
    return false;
  const spec = definition(ruleset);
  return (
    spec.phaseReplacement.phases.includes(phase) &&
    spec.phaseReplacement.ownerTurns.includes(
      Number(card.runtime.ownerTurnOrdinal ?? 0),
    )
  );
}

export function beginGoldenMaskReplacement(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  seat: Seat,
  phase: Phase,
  deadlineAt: number,
): void {
  const ref = tx.draft.zones[`boss:${seat}`]!.orderedCardRefs[0];
  if (!ref) throw new Error("GOLDEN_MASK_SOURCE_MISSING");
  beginJudgmentInTransaction(
    tx,
    ruleset,
    {
      controllerSeat: seat,
      sourceRef: ref,
      purpose: "branch",
      matchColors: [],
      context: {
        goldenMaskReplacement: true,
        goldenMaskPhase: phase,
        goldenMaskDeadlineAt: deadlineAt,
      },
    },
    deadlineAt,
  );
  tx.emit("boss.effect.started", {
    sourceRef: ref,
    modeId: "chaosStrike",
    replacedPhase: phase,
  });
}

const templateByColor: Partial<Record<PrintedColor, string>> = {
  green: "pineapple",
  blue: "stoneCrab",
  orange: "explosivePack",
  red: "airSupport",
};

export function openGoldenMaskTargetWindowAfterJudgment(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  context: Record<string, JsonValue>,
  finalColor: PrintedColor | null,
): void {
  if (context.goldenMaskReplacement !== true) return;
  const seat = Number(context.controllerSeat) as Seat,
    sourceRef = tx.draft.zones[`boss:${seat}`]!.orderedCardRefs[0],
    templateId = finalColor ? templateByColor[finalColor] : undefined;
  if (!sourceRef || !templateId) {
    tx.emit("boss.effect.resolved", {
      sourceRef: sourceRef ?? null,
      modeId: "chaosStrike",
      finalColor,
      result: "noAttack",
    });
    return;
  }
  const template = definition(ruleset).attackTemplates[templateId]!;
  const targets = tx.draft.players
    .filter(
      (player) =>
        player.presence === "inPlay" &&
        player.lifeState !== "eliminated" &&
        calculateEffectiveDistance(tx.draft, seat, player.seat) <=
          template.range,
    )
    .map((player) => `character:${player.seat}`);
  const promptId = `prompt:golden-mask:${sourceRef}:${tx.draft.stateRevision + 1}`;
  tx.draft.pendingWindows.push({
    promptId,
    kind: "goldenMaskTarget",
    prioritySeat: seat,
    mandatory: false,
    deadlineAt: Number(context.goldenMaskDeadlineAt ?? 0),
    timeoutPolicy: "pass",
    legalOfferIds: [
      `offer:golden-mask:pass:${sourceRef}`,
      ...targets.map((targetRef) => `offer:golden-mask:target:${targetRef}`),
    ],
    context: {
      sourceRef,
      templateId,
      finalColor: finalColor!,
      legalTargetRefs: targets,
      goldenMaskPhase: context.goldenMaskPhase!,
      goldenMaskDeadlineAt: context.goldenMaskDeadlineAt ?? 0,
    },
  });
  tx.emit("choice.requested", {
    kind: "goldenMaskTarget",
    promptId,
    seat,
    sourceRef,
    templateId,
    legalTargetRefs: targets,
  });
}

export function completeGoldenMaskReplacement(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  seat: Seat,
  phase: Phase,
  deadlineAt: number,
): void {
  tx.emit("phase.after", { seat, phase, skipped: false, replaced: true });
  if (phase === "play")
    openC6BombardmentAtPlayAfter(tx, ruleset, seat, deadlineAt);
  expireStatusesAtPhaseAfter(tx, seat, phase, false);
  tx.emit("boss.effect.resolved", {
    sourceRef: tx.draft.zones[`boss:${seat}`]?.orderedCardRefs[0] ?? null,
    modeId: "chaosStrike",
    replacedPhase: phase,
  });
}

export function continueGoldenMaskAfterJudgment(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  context: Record<string, JsonValue>,
  finalColor: PrintedColor | null,
) {
  const tx = new EngineTransaction(state);
  openGoldenMaskTargetWindowAfterJudgment(tx, ruleset, context, finalColor);
  if (!finalColor || finalColor === "white")
    completeGoldenMaskReplacement(
      tx,
      ruleset,
      Number(context.controllerSeat) as Seat,
      String(context.goldenMaskPhase) as Phase,
      Number(context.goldenMaskDeadlineAt ?? 0),
    );
  const committed = tx.commit();
  committed.state.history.domainEvents.push(...committed.events);
  validateAuthoritativeState(committed.state);
  return committed;
}

export interface GoldenMaskTargetCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  targetRef?: string;
}
export type GoldenMaskTargetResult =
  | {
      accepted: true;
      commandId: string;
      previousRevision: number;
      stateRevision: number;
      events: DomainEvent[];
    }
  | {
      accepted: false;
      commandId: string;
      stateRevision: number;
      reasonCode: string;
      refreshRequired: boolean;
    };

export class GoldenMaskTargetSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, GoldenMaskTargetResult>();
  constructor(
    state: AuthoritativeGameState,
    private readonly ruleset: LoadedRuleset,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  handle(command: GoldenMaskTargetCommand): GoldenMaskTargetResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (
      reasonCode: string,
      refreshRequired: boolean,
    ): GoldenMaskTargetResult => {
      const result = {
        accepted: false as const,
        commandId: command.commandId,
        stateRevision: this.#state.stateRevision,
        reasonCode,
        refreshRequired,
      };
      this.#results.set(command.commandId, result);
      return structuredClone(result);
    };
    if (command.gameId !== this.#state.gameId)
      return reject("GAME_NOT_FOUND", false);
    if (command.expectedStateRevision !== this.#state.stateRevision)
      return reject("STALE_REVISION", true);
    const window = this.#state.pendingWindows.find(
      (item) => item.kind === "goldenMaskTarget",
    );
    if (!window || window.promptId !== command.promptId)
      return reject("PROMPT_CLOSED", true);
    const actor = this.#state.players.find(
      (item) => item.userId === command.actorUserId,
    );
    if (!actor || actor.seat !== window.prioritySeat)
      return reject("NOT_YOUR_PRIORITY", false);
    if (!window.legalOfferIds.includes(command.offerId))
      return reject("OFFER_EXPIRED", true);
    const pass = command.offerId.includes(":pass:"),
      legalTargets = Array.isArray(window.context?.legalTargetRefs)
        ? window.context.legalTargetRefs
        : [];
    if (
      !pass &&
      (!command.targetRef ||
        !legalTargets.includes(command.targetRef) ||
        !command.offerId.endsWith(command.targetRef))
    )
      return reject("TARGET_INVALID", false);
    if (pass && command.targetRef) return reject("TARGET_INVALID", false);
    const tx = new EngineTransaction(this.#state),
      context = window.context!,
      seat = actor.seat,
      phase = String(context.goldenMaskPhase ?? this.#state.phase) as Phase,
      deadlineAt = Number(context.goldenMaskDeadlineAt ?? window.deadlineAt),
      sourceRef = String(context.sourceRef),
      templateId = String(context.templateId);
    tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
      (item) => item.promptId !== window.promptId,
    );
    if (pass) {
      completeGoldenMaskReplacement(tx, this.ruleset, seat, phase, deadlineAt);
    } else {
      const template = definition(this.ruleset).attackTemplates[templateId]!;
      const customJudgments =
        templateId === "explosivePack"
          ? [
              {
                judgmentId: "goldenMask.explosivePack.onHit",
                timing: "hitDetermined.beforeDamage",
                purpose: "additionalEffect",
                runOnHit: true,
                outcomes: {
                  red: {
                    matched: true,
                    effects: [
                      {
                        op: "createDamage",
                        params: {
                          segment: {
                            segmentId: "explosivePack.fire",
                            deliveryType: "attack",
                            attackType: "field",
                            damageType: "normal",
                            element: "fire",
                            amount: 1,
                            repeat: 1,
                            isAdditional: true,
                            overflowPolicy: "normal",
                          },
                        },
                      },
                    ],
                  },
                  orange: {
                    matched: true,
                    effects: [
                      {
                        op: "createDamage",
                        params: {
                          segment: {
                            segmentId: "explosivePack.fire",
                            deliveryType: "attack",
                            attackType: "field",
                            damageType: "normal",
                            element: "fire",
                            amount: 1,
                            repeat: 1,
                            isAdditional: true,
                            overflowPolicy: "normal",
                          },
                        },
                      },
                    ],
                  },
                  default: { matched: false, effects: [] },
                },
              },
            ]
          : undefined;
      createScriptedAttackInTransaction(tx, {
        attackId: `attack:golden-mask:${sourceRef}:${this.#state.stateRevision + 1}`,
        attackerSeat: seat,
        targetRef: command.targetRef!,
        sourceRef,
        weaponId: `boss.golden_mask.${templateId}`,
        modeId: templateId,
        range: template.range,
        attackTypes: [template.attackType],
        damageSegments: [
          {
            segmentId: templateId,
            deliveryType: "attack",
            attackType: template.attackType,
            damageType: "normal",
            element: "none",
            amount: template.damage.amount,
            repeat: template.damage.repeat,
            isAdditional: false,
            overflowPolicy: "normal",
          },
        ],
        ...(customJudgments ? { customJudgments } : {}),
        ignoreArmor: template.attackType === "field",
        tags: ["bossAttack", "goldenMaskChaosStrike"],
      });
      const attack = tx.draft.combat.attack as Record<string, JsonValue>;
      attack.goldenMaskReplacement = {
        seat,
        phase,
        deadlineAt,
      };
      if (templateId === "airSupport")
        attack.onHitStatuses = ["status.electrified"];
    }
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    validateAuthoritativeState(committed.state);
    this.#state = committed.state;
    const result = {
      accepted: true as const,
      commandId: command.commandId,
      previousRevision: committed.previousRevision,
      stateRevision: committed.state.stateRevision,
      events: committed.events,
    };
    this.#results.set(command.commandId, result);
    return structuredClone(result);
  }
  handleTimeout(commandId: string) {
    const window = this.#state.pendingWindows.find(
      (item) => item.kind === "goldenMaskTarget",
    );
    if (!window)
      return {
        accepted: false as const,
        commandId,
        stateRevision: this.#state.stateRevision,
        reasonCode: "PROMPT_CLOSED",
        refreshRequired: true,
      };
    const actor = this.#state.players.find(
      (item) => item.seat === window.prioritySeat,
    )!;
    return this.handle({
      commandId,
      gameId: this.#state.gameId,
      expectedStateRevision: this.#state.stateRevision,
      actorUserId: actor.userId,
      promptId: window.promptId,
      offerId: window.legalOfferIds.find((id) => id.includes(":pass:"))!,
    });
  }
}
