import type { LoadedRuleset } from "../ruleset/types.js";
import { calculateTargetOffer } from "./targets.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { createScriptedAttackInTransaction } from "./scriptedAttack.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent, TransactionCommit } from "./types.js";
const activePurple = (state: AuthoritativeGameState, seat: Seat) => {
  const ref = state.zones[`boss:${seat}`]?.orderedCardRefs[0],
    card = ref ? state.cards[ref] : undefined;
  return card?.templateId === "boss.purple_lord" && card.runtime.active === true
    ? card
    : undefined;
};
const freezeEffect = {
  op: "applyStatus",
  params: { statusId: "status.frozen" },
};
const demonJudgments = [
  {
    judgmentId: "purpleLordDemonBlade",
    timing: "hitDetermined.beforeDamage",
    purpose: "status",
    runOnHit: true,
    outcomes: {
      white: { matched: true, effects: [freezeEffect] },
      blue: { matched: true, effects: [freezeEffect] },
      default: { matched: false, effects: [] },
    },
  },
];
export function queuePurpleLordDemonBlade(
  tx: EngineTransaction<AuthoritativeGameState>,
  actorSeat: Seat,
): void {
  const owner = tx.draft.players.find(
    (player) =>
      player.seat !== actorSeat && activePurple(tx.draft, player.seat),
  );
  if (!owner) return;
  const card = activePurple(tx.draft, owner.seat)!;
  createScriptedAttackInTransaction(tx, {
    attackId: `attack:purple-demon:${card.cardRef}:${tx.draft.round}:${actorSeat}`,
    attackerSeat: owner.seat,
    targetRef: `character:${actorSeat}`,
    sourceRef: card.cardRef,
    weaponId: "boss.purple_lord.demonBlade",
    modeId: "demonBlade",
    range: "unlimited",
    attackTypes: ["melee"],
    damageSegments: [
      {
        segmentId: "demonBlade",
        deliveryType: "attack",
        attackType: "melee",
        damageType: "normal",
        element: "none",
        amount: 2,
        repeat: 1,
        isAdditional: false,
        overflowPolicy: "normal",
      },
    ],
    customJudgments: demonJudgments,
    tags: ["bossAttack", "purpleLordDemonBlade"],
  });
}
export function openPurpleLordHeroBladeWindow(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  seat: Seat,
  deadlineAt: number,
): void {
  const card = activePurple(tx.draft, seat);
  if (
    !card ||
    Number(card.runtime.ownerTurnOrdinal) !== 1 ||
    card.runtime.heroBladeWindowResolved === true
  )
    return;
  const offer = calculateTargetOffer(tx.draft, seat, {
      kind: "character",
      min: 0,
      max: 1,
      distinct: true,
      includeSelf: true,
      team: "any",
      presence: "inPlay",
      maxDistance: 4,
    }),
    promptId = `prompt:purple-hero:${card.cardRef}:${tx.draft.round}`;
  card.runtime.heroBladeWindowResolved = true;
  tx.draft.pendingWindows.push({
    promptId,
    kind: "purpleLordHeroBlade",
    prioritySeat: seat,
    mandatory: false,
    deadlineAt,
    timeoutPolicy: "pass",
    legalOfferIds: [
      `offer:purple-hero:pass:${card.cardRef}`,
      ...(offer.legalTargetRefs.length
        ? [`offer:purple-hero:attack:${card.cardRef}`]
        : []),
    ],
    context: { cardRef: card.cardRef, legalTargetRefs: offer.legalTargetRefs },
  });
  tx.emit("choice.requested", {
    kind: "purpleLordHeroBlade",
    promptId,
    seat,
    cardRef: card.cardRef,
    legalTargetRefs: offer.legalTargetRefs,
  });
}
export interface PurpleHeroCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  targetRef?: string;
}
export type PurpleHeroResult =
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
export class PurpleLordHeroBladeSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, PurpleHeroResult>();
  constructor(
    state: AuthoritativeGameState,
    private readonly ruleset: LoadedRuleset,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  handle(command: PurpleHeroCommand): PurpleHeroResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (
      reasonCode: string,
      refreshRequired: boolean,
    ): PurpleHeroResult => {
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
      (item) => item.kind === "purpleLordHeroBlade",
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
    const activate = command.offerId.includes(":attack:");
    if (activate) {
      const current = calculateTargetOffer(this.#state, actor.seat, {
        kind: "character",
        min: 1,
        max: 1,
        distinct: true,
        includeSelf: true,
        team: "any",
        presence: "inPlay",
        maxDistance: 4,
      });
      if (
        !command.targetRef ||
        !current.legalTargetRefs.includes(command.targetRef)
      )
        return reject("TARGET_NO_LONGER_LEGAL", true);
    } else if (command.targetRef) return reject("TARGET_INVALID", false);
    const tx = new EngineTransaction(this.#state);
    tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
      (item) => item.promptId !== window.promptId,
    );
    if (activate) {
      const cardRef = String(window.context?.cardRef);
      if (
        !activePurple(tx.draft, actor.seat) ||
        tx.draft.cards[cardRef]?.runtime.active !== true
      )
        return reject("BOSS_NO_LONGER_ACTIVE", true);
      createScriptedAttackInTransaction(tx, {
        attackId: `attack:purple-hero:${cardRef}:${tx.draft.round}`,
        attackerSeat: actor.seat,
        targetRef: command.targetRef!,
        sourceRef: cardRef,
        weaponId: "boss.purple_lord.heroBlade",
        modeId: "heroBlade",
        range: 4,
        attackTypes: ["melee"],
        damageSegments: [
          {
            segmentId: "heroBlade",
            deliveryType: "attack",
            attackType: "melee",
            damageType: "normal",
            element: "none",
            amount: 4,
            repeat: 1,
            isAdditional: false,
            overflowPolicy: "normal",
          },
        ],
        tags: ["bossAttack", "purpleLordHeroBlade"],
      });
    } else
      tx.emit("boss.specialWindow.passed", {
        bossId: "boss.purple_lord",
        windowId: "purpleLord.heroBlade",
        seat: actor.seat,
      });
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
  handleTimeout(commandId: string): PurpleHeroResult {
    const window = this.#state.pendingWindows.find(
      (item) => item.kind === "purpleLordHeroBlade",
    );
    if (!window)
      return {
        accepted: false,
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
