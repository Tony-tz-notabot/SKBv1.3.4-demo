import type { LoadedRuleset } from "../ruleset/types.js";
import { calculateTargetOffer } from "./targets.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent, JsonValue } from "./types.js";
import { moveCardInTransaction } from "./zoneMovement.js";
import { createScriptedAttackInTransaction } from "./scriptedAttack.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import type { TransactionCommit } from "./types.js";

const CHARACTER = "character.qi_master",
  ABILITY = "skill.qi_master.qi_ball";
const talent = (s: AuthoritativeGameState, seat: Seat, id: string) => {
  const p = s.players.find((x) => x.seat === seat)!;
  return (
    p.initialTalentIds.includes(id) ||
    Object.values(s.zones)
      .filter((z) => z.ownerSeat === seat && z.zoneType === "talentZone")
      .flatMap((z) => z.orderedCardRefs)
      .some((ref) => s.cards[ref]?.templateId === id)
  );
};
const key = (s: AuthoritativeGameState) =>
  `${s.round}:${s.activeSeat}:${[...s.history.domainEvents].reverse().find((e) => e.eventType === "turn.start")?.eventSeq ?? 0}`;
export function buildQiBallOffers(
  s: AuthoritativeGameState,
  r: LoadedRuleset,
  seat: Seat,
) {
  const p = s.players.find((x) => x.seat === seat),
    w = s.pendingWindows.find(
      (x) => x.kind === "playPhaseAction" && x.prioritySeat === seat,
    ),
    cards = s.zones[`hand:${seat}`]?.orderedCardRefs ?? [],
    count = Number(p?.limits[r.settings.combat.attackCountLimitId] ?? 0);
  if (
    !p ||
    p.characterId !== CHARACTER ||
    !p.skillIds.includes(ABILITY) ||
    s.activeSeat !== seat ||
    s.phase !== "play" ||
    s.phaseBoundary !== "body" ||
    !w ||
    s.combat.attack ||
    cards.length < 2 ||
    count < 1 ||
    p.markers["qiBall.usedTurn"] === key(s)
  )
    return [];
  return [
    {
      offerId: `offer:${ABILITY}`,
      legalCardRefs: cards,
      legalTargetRefs: calculateTargetOffer(s, seat, {
        kind: "character",
        min: 1,
        max: 1,
        distinct: true,
        includeSelf: true,
        team: "any",
        presence: "inPlay",
      }).legalTargetRefs,
    },
  ];
}
export interface QiBallCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  cardRefs: string[];
  targetRef: string;
}
type Result =
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
export class QiBallSession {
  #state: AuthoritativeGameState;
  #results = new Map<string, Result>();
  constructor(
    s: AuthoritativeGameState,
    private r: LoadedRuleset,
  ) {
    this.#state = s;
  }
  get state() {
    return this.#state;
  }
  handle(c: QiBallCommand): Result {
    const old = this.#results.get(c.commandId);
    if (old) return structuredClone(old);
    const reject = (reasonCode: string, refreshRequired: boolean): Result => ({
      accepted: false,
      commandId: c.commandId,
      stateRevision: this.#state.stateRevision,
      reasonCode,
      refreshRequired,
    });
    if (c.gameId !== this.#state.gameId) return reject("GAME_NOT_FOUND", false);
    if (c.expectedStateRevision !== this.#state.stateRevision)
      return reject("STALE_REVISION", true);
    const actor = this.#state.players.find((x) => x.userId === c.actorUserId),
      w = actor
        ? this.#state.pendingWindows.find(
            (x) => x.promptId === c.promptId && x.prioritySeat === actor.seat,
          )
        : undefined,
      offer = actor
        ? buildQiBallOffers(this.#state, this.r, actor.seat)[0]
        : undefined;
    if (!actor || !w) return reject("NOT_YOUR_PRIORITY", false);
    if (!offer || c.offerId !== offer.offerId)
      return reject("OFFER_EXPIRED", true);
    if (
      c.cardRefs.length !== 2 ||
      new Set(c.cardRefs).size !== 2 ||
      c.cardRefs.some((x) => !offer.legalCardRefs.includes(x))
    )
      return reject("COST_SELECTION_INVALID", false);
    if (!offer.legalTargetRefs.includes(c.targetRef))
      return reject("TARGET_SELECTION_INVALID", false);
    const tx = new EngineTransaction(this.#state),
      p = tx.draft.players.find((x) => x.seat === actor.seat)!;
    tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
      (x) => x.promptId !== w.promptId,
    );
    for (const ref of c.cardRefs)
      moveCardInTransaction(tx, {
        cardRef: ref,
        toZoneRef: "discardPile",
        moveKind: "discard",
        faceUp: true,
      });
    p.limits[this.r.settings.combat.attackCountLimitId] =
      Number(p.limits[this.r.settings.combat.attackCountLimitId]) - 1;
    p.markers["qiBall.usedTurn"] = key(tx.draft);
    const fire = talent(tx.draft, actor.seat, "talent.fire_shield"),
      poison = talent(tx.draft, actor.seat, "talent.poison_shield"),
      ice = talent(tx.draft, actor.seat, "talent.ice_shield"),
      electric = talent(tx.draft, actor.seat, "talent.electric_shield"),
      breaker = talent(tx.draft, actor.seat, "talent.shield_breaker"),
      thorn = talent(tx.draft, actor.seat, "talent.spike_shield");
    const segments: JsonValue[] = [
      {
        segmentId: "qiBall.base",
        deliveryType: "attack",
        attackType: "ranged",
        damageType: "normal",
        element: "none",
        amount: thorn ? 3 : 2,
        repeat: 1,
        isAdditional: false,
        overflowPolicy: "normal",
      },
    ];
    if (fire)
      segments.push({
        segmentId: "qiBall.fire",
        deliveryType: "attack",
        attackType: "effect",
        damageType: "normal",
        element: "fire",
        amount: 1,
        repeat: 1,
        isAdditional: true,
        overflowPolicy: "normal",
      });
    if (poison)
      segments.push({
        segmentId: "qiBall.poison",
        deliveryType: "attack",
        attackType: "effect",
        damageType: "normal",
        element: "poison",
        amount: 1,
        repeat: 1,
        isAdditional: true,
        overflowPolicy: "normal",
      });
    const custom = ice
      ? [
          {
            judgmentId: "qiBall.ice",
            timing: "hitDetermined.beforeDamage",
            purpose: "qiBallIce",
            runOnHit: true,
            outcomes: {
              blue: {
                matched: true,
                effects: [
                  { op: "applyStatus", params: { statusId: "status.frozen" } },
                ],
              },
              green: {
                matched: true,
                effects: [
                  { op: "applyStatus", params: { statusId: "status.frozen" } },
                ],
              },
              default: { matched: false, effects: [] },
            },
          },
        ]
      : undefined;
    createScriptedAttackInTransaction(tx, {
      attackId: `attack:qi-ball:${tx.draft.stateRevision + 1}`,
      attackerSeat: actor.seat,
      targetRef: c.targetRef,
      sourceRef: `character:${actor.seat}`,
      weaponId: ABILITY,
      modeId: "qiBall",
      range: "unlimited",
      attackTypes: ["ranged"],
      damageSegments: segments,
      ...(custom ? { customJudgments: custom } : {}),
      cannotMeleeBlock: false,
      tags: ["qiBall", ...(breaker ? ["qiBallShieldBreaker"] : [])],
      resumePlayDeadlineAt: w.deadlineAt,
    });
    if (electric)
      (tx.draft.combat.attack as Record<string, JsonValue>).cannotHandDodge =
        true;
    tx.emit("ability.activation.committed", {
      seat: actor.seat,
      abilityId: ABILITY,
      targetRef: c.targetRef,
      cardRefs: c.cardRefs,
    });
    const out = tx.commit();
    out.state.history.domainEvents.push(...out.events);
    validateAuthoritativeState(out.state);
    this.#state = out.state;
    const result = {
      accepted: true as const,
      commandId: c.commandId,
      previousRevision: out.previousRevision,
      stateRevision: out.state.stateRevision,
      events: out.events,
    };
    this.#results.set(c.commandId, result);
    return structuredClone(result);
  }
}

export function processQiBallShieldBreaker(
  c: TransactionCommit<AuthoritativeGameState>,
  r: LoadedRuleset,
  deadlineAt: number,
) {
  for (const e of c.events)
    if (e.eventType === "attack.target.after") {
      const d = e.payload as Record<string, unknown>,
        tags = Array.isArray(d.tags) ? d.tags : [];
      if (!tags.includes("qiBallShieldBreaker") || d.hit !== true) continue;
      const targetSeat = Number(String(d.targetRef).split(":")[1]) as Seat,
        refs = Object.values(c.state.zones)
          .filter(
            (z) =>
              z.ownerSeat === targetSeat &&
              !["outsideDeck", "removedFromGame", "resolving"].includes(
                z.zoneType,
              ) &&
              (z.zoneType !== "bossSlot" ||
                r.settings.boss.allowGenericDismantle),
          )
          .flatMap((z) => z.orderedCardRefs);
      if (!refs.length) return c;
      const seat = Number(d.attackerSeat) as Seat,
        tx = new EngineTransaction(c.state),
        promptId = `prompt:qi-ball-dismantle:${String(d.attackId)}`;
      tx.draft.pendingWindows.unshift({
        promptId,
        kind: "qiBallDismantle",
        prioritySeat: seat,
        mandatory: true,
        deadlineAt,
        timeoutPolicy: "randomLegal",
        legalOfferIds: ["offer:qi-ball-dismantle"],
        context: { targetSeat, legalCardRefs: refs },
      });
      tx.emit("choice.requested", {
        kind: "qiBallDismantle",
        promptId,
        seat,
        targetSeat,
        legalCardRefs: refs,
      });
      const out = tx.commit();
      out.state.history.domainEvents.push(...out.events);
      return {
        previousRevision: c.previousRevision,
        state: out.state,
        events: [...c.events, ...out.events],
      };
    }
  return c;
}
export class QiBallDismantleSession {
  #state: AuthoritativeGameState;
  constructor(
    s: AuthoritativeGameState,
    private r: LoadedRuleset,
  ) {
    this.#state = s;
  }
  get state() {
    return this.#state;
  }
  handle(c: {
    commandId: string;
    actorUserId: string;
    promptId: string;
    cardRef: string;
  }) {
    const w = this.#state.pendingWindows.find(
        (x) => x.kind === "qiBallDismantle" && x.promptId === c.promptId,
      ),
      p = this.#state.players.find((x) => x.userId === c.actorUserId),
      refs = Array.isArray(w?.context?.legalCardRefs)
        ? w.context.legalCardRefs
        : [],
      targetSeat = Number(w?.context?.targetSeat) as Seat;
    if (
      !w ||
      !p ||
      p.seat !== w.prioritySeat ||
      !refs.includes(c.cardRef) ||
      this.#state.cards[c.cardRef]?.ownerSeat !== targetSeat
    )
      return {
        accepted: false as const,
        commandId: c.commandId,
        stateRevision: this.#state.stateRevision,
        reasonCode: "CARD_NO_LONGER_LEGAL",
        refreshRequired: true,
      };
    const tx = new EngineTransaction(this.#state);
    tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
      (x) => x.promptId !== w.promptId,
    );
    moveCardInTransaction(tx, {
      cardRef: c.cardRef,
      toZoneRef: "discardPile",
      moveKind: "dismantle",
      faceUp: true,
    });
    tx.emit("card.dismantled", {
      cardRef: c.cardRef,
      sourceSeat: p.seat,
      targetSeat,
      sourceRef: ABILITY,
    });
    const out = tx.commit();
    out.state.history.domainEvents.push(...out.events);
    validateAuthoritativeState(out.state);
    this.#state = out.state;
    return {
      accepted: true as const,
      commandId: c.commandId,
      previousRevision: out.previousRevision,
      stateRevision: out.state.stateRevision,
      events: out.events,
    };
  }
}
