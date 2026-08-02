import type { LoadedRuleset } from "../ruleset/types.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { calculateTargetOffer } from "./targets.js";
import { createScriptedAttackInTransaction } from "./scriptedAttack.js";
import { moveCardInTransaction } from "./zoneMovement.js";
const C = "character.engineer";
export type MechKind = "prototype" | "vitaminC" | "wifi";
const specs = {
  prototype: {
    shield: 5,
    iron: 1,
    defense: 0,
    type: "ranged",
    range: 2,
    amount: 2,
    repeat: 2,
  },
  vitaminC: {
    shield: 2,
    iron: 2,
    defense: 0,
    type: "field",
    range: 1,
    amount: 3,
    repeat: 1,
  },
  wifi: {
    shield: 6,
    iron: 0,
    defense: 2,
    type: "laser",
    range: 3,
    amount: 3,
    repeat: 1,
  },
} as const;
export function exitMech(
  tx: EngineTransaction<AuthoritativeGameState>,
  seat: Seat,
  reason: string,
) {
  const p = tx.draft.players.find((x) => x.seat === seat)!;
  if (p.markers["engineer.mechActive"] !== true) return;
  const iron = Number(p.markers["engineer.mechIron"] ?? 0),
    def = Number(p.markers["engineer.mechDefense"] ?? 0);
  p.ironShield = Math.max(0, p.ironShield - iron);
  p.limits.defenseDistanceModifier =
    Number(p.limits.defenseDistanceModifier ?? 0) - def;
  for (const k of Object.keys(p.markers).filter((x) =>
    x.startsWith("engineer.mech"),
  ))
    delete p.markers[k];
  p.markers["engineer.mechFinished"] = true;
  tx.emit("form.exited", { seat, formId: "engineer.mech", reason });
}
export function openEngineerMechAtPrepare(
  tx: EngineTransaction<AuthoritativeGameState>,
  seat: Seat,
  deadlineAt: number,
) {
  const p = tx.draft.players.find((x) => x.seat === seat)!;
  if (p.characterId !== C || p.markers["engineer.mechFinished"] === true)
    return false;
  if (p.markers["engineer.mechActive"] === true) {
    const n = Number(p.markers["engineer.mechPrepareOrdinal"] ?? 1) + 1;
    p.markers["engineer.mechPrepareOrdinal"] = n;
    if (n >= 4) exitMech(tx, seat, "fourthPrepare");
    return false;
  }
  const promptId = `prompt:engineer-mech:${tx.draft.stateRevision + 1}`;
  tx.draft.pendingWindows.push({
    promptId,
    kind: "engineerMechChoice",
    prioritySeat: seat,
    mandatory: true,
    deadlineAt,
    timeoutPolicy: "randomLegal",
    legalOfferIds: Object.keys(specs).map((x) => `offer:engineer-mech:${x}`),
    context: {},
  });
  return true;
}
export class EngineerMechChoiceSession {
  #state: AuthoritativeGameState;
  constructor(s: AuthoritativeGameState) {
    this.#state = s;
  }
  get state() {
    return this.#state;
  }
  handle(c: {
    commandId: string;
    gameId: string;
    expectedStateRevision: number;
    actorUserId: string;
    promptId: string;
    offerId: string;
  }) {
    const w = this.#state.pendingWindows.find(
        (x) => x.kind === "engineerMechChoice" && x.promptId === c.promptId,
      ),
      p = this.#state.players.find((x) => x.userId === c.actorUserId),
      kind = c.offerId.split(":").at(-1) as MechKind;
    if (
      !w ||
      !p ||
      p.seat !== w.prioritySeat ||
      !w.legalOfferIds.includes(c.offerId) ||
      !specs[kind]
    )
      return {
        accepted: false as const,
        commandId: c.commandId,
        stateRevision: this.#state.stateRevision,
        reasonCode: "OFFER_EXPIRED",
        refreshRequired: true,
      };
    const tx = new EngineTransaction(this.#state),
      d = tx.draft.players.find((x) => x.seat === p.seat)!,
      q = specs[kind];
    tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
      (x) => x.promptId !== w.promptId,
    );
    Object.assign(d.markers, {
      "engineer.mechActive": true,
      "engineer.mechKind": kind,
      "engineer.mechShield": q.shield,
      "engineer.mechMaxShield": q.shield,
      "engineer.mechIron": q.iron,
      "engineer.mechDefense": q.defense,
      "engineer.mechPrepareOrdinal": 1,
    });
    d.ironShield += q.iron;
    d.limits.defenseDistanceModifier =
      Number(d.limits.defenseDistanceModifier ?? 0) + q.defense;
    tx.emit("form.entered", {
      seat: p.seat,
      formId: "engineer.mech",
      kind,
      shield: q.shield,
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
export function buildMechAttackOffers(
  s: AuthoritativeGameState,
  r: LoadedRuleset,
  seat: Seat,
) {
  const p = s.players.find((x) => x.seat === seat),
    w = s.pendingWindows.find(
      (x) => x.kind === "playPhaseAction" && x.prioritySeat === seat,
    ),
    kind = p?.markers["engineer.mechKind"] as MechKind,
    q = specs[kind],
    kills =
      s.zones[`hand:${seat}`]?.orderedCardRefs.filter((x) =>
        s.cards[x]!.templateId.startsWith(r.settings.combat.killTemplatePrefix),
      ) ?? [];
  if (
    !p ||
    p.markers["engineer.mechActive"] !== true ||
    !q ||
    !w ||
    s.combat.attack ||
    Number(p.limits[r.settings.combat.attackCountLimitId]) < 1 ||
    !kills.length
  )
    return [];
  return [
    {
      offerId: `offer:engineer-mech-attack:${kind}`,
      legalKillCardRefs: kills,
      legalTargetRefs: calculateTargetOffer(s, seat, {
        kind: "character",
        min: 1,
        max: 1,
        distinct: true,
        includeSelf: true,
        team: "any",
        presence: "inPlay",
        maxDistance: q.range,
      }).legalTargetRefs,
    },
  ];
}
export class MechAttackSession {
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
    offerId: string;
    killCardRef: string;
    targetRef: string;
  }) {
    const p = this.#state.players.find((x) => x.userId === c.actorUserId),
      w = p
        ? this.#state.pendingWindows.find(
            (x) => x.promptId === c.promptId && x.prioritySeat === p.seat,
          )
        : undefined,
      o = p ? buildMechAttackOffers(this.#state, this.r, p.seat)[0] : undefined;
    if (
      !p ||
      !w ||
      !o ||
      c.offerId !== o.offerId ||
      !o.legalKillCardRefs.includes(c.killCardRef) ||
      !o.legalTargetRefs.includes(c.targetRef)
    )
      return {
        accepted: false as const,
        commandId: c.commandId,
        stateRevision: this.#state.stateRevision,
        reasonCode: "OFFER_EXPIRED",
        refreshRequired: true,
      };
    const tx = new EngineTransaction(this.#state),
      d = tx.draft.players.find((x) => x.seat === p.seat)!,
      kind = d.markers["engineer.mechKind"] as MechKind,
      q = specs[kind];
    tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
      (x) => x.promptId !== w.promptId,
    );
    moveCardInTransaction(tx, {
      cardRef: c.killCardRef,
      toZoneRef: "resolving",
      moveKind: "play",
      faceUp: true,
    });
    d.limits[this.r.settings.combat.attackCountLimitId] =
      Number(d.limits[this.r.settings.combat.attackCountLimitId]) - 1;
    createScriptedAttackInTransaction(tx, {
      attackId: `attack:mech:${tx.draft.stateRevision + 1}`,
      attackerSeat: p.seat,
      targetRef: c.targetRef,
      sourceRef: null,
      weaponId: `engineer.mech.${kind}`,
      modeId: kind,
      range: q.range,
      attackTypes: [q.type],
      damageSegments: [
        {
          segmentId: "mech",
          deliveryType: "attack",
          attackType: q.type,
          damageType: "normal",
          element: "none",
          amount: q.amount,
          repeat: q.repeat,
          isAdditional: false,
          overflowPolicy: "normal",
        },
      ],
      ignoreArmor: q.type === "field",
      costCardRefs: [c.killCardRef],
      resumePlayDeadlineAt: w.deadlineAt,
      tags: ["mechWeapon"],
    });
    const out = tx.commit();
    out.state.history.domainEvents.push(...out.events);
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
export function buildMechExitOffers(s: AuthoritativeGameState, seat: Seat) {
  const p = s.players.find((x) => x.seat === seat),
    w = s.pendingWindows.find(
      (x) => x.kind === "playPhaseAction" && x.prioritySeat === seat,
    );
  return p?.markers["engineer.mechActive"] === true &&
    s.activeSeat === seat &&
    s.phase === "play" &&
    s.phaseBoundary === "body" &&
    w &&
    !s.combat.attack
    ? [{ offerId: "offer:engineer-mech-exit" }]
    : [];
}
export class MechExitSession {
  #state: AuthoritativeGameState;
  constructor(s: AuthoritativeGameState) {
    this.#state = s;
  }
  get state() {
    return this.#state;
  }
  handle(c: {
    commandId: string;
    actorUserId: string;
    promptId: string;
    offerId: string;
  }) {
    const p = this.#state.players.find((x) => x.userId === c.actorUserId),
      w = p
        ? this.#state.pendingWindows.find(
            (x) => x.promptId === c.promptId && x.prioritySeat === p.seat,
          )
        : undefined;
    if (
      !p ||
      !w ||
      c.offerId !== "offer:engineer-mech-exit" ||
      !buildMechExitOffers(this.#state, p.seat).length
    )
      return {
        accepted: false as const,
        commandId: c.commandId,
        stateRevision: this.#state.stateRevision,
        reasonCode: "OFFER_EXPIRED",
        refreshRequired: true,
      };
    const tx = new EngineTransaction(this.#state);
    exitMech(tx, p.seat, "activeExit");
    tx.emit("ability.activation.committed", {
      seat: p.seat,
      abilityId: "skill.engineer.mech_maniac",
      mode: "activeExit",
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
