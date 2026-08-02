import type { LoadedRuleset } from "../ruleset/types.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent, TransactionCommit } from "./types.js";
import { calculateTargetOffer } from "./targets.js";
import { createScriptedAttackInTransaction } from "./scriptedAttack.js";
import { addDrawCountModifierInTransaction } from "./drawCount.js";
import { validateAuthoritativeState } from "./stateValidation.js";
const C = "character.druid",
  A = "skill.druid.vine_entanglement";
export function tickVineCooldown(
  tx: EngineTransaction<AuthoritativeGameState>,
  seat: Seat,
) {
  const p = tx.draft.players.find((x) => x.seat === seat)!,
    n = Number(p.markers["druid.vineCooldown"] ?? 0);
  if (n > 0) {
    if (n === 1) delete p.markers["druid.vineCooldown"];
    else p.markers["druid.vineCooldown"] = n - 1;
  }
}
export function buildVineOffers(
  s: AuthoritativeGameState,
  _r: LoadedRuleset,
  seat: Seat,
) {
  const p = s.players.find((x) => x.seat === seat),
    w = s.pendingWindows.find(
      (x) => x.kind === "playPhaseAction" && x.prioritySeat === seat,
    );
  if (
    !p ||
    p.characterId !== C ||
    !p.skillIds.includes(A) ||
    s.activeSeat !== seat ||
    s.phase !== "play" ||
    s.phaseBoundary !== "body" ||
    !w ||
    s.combat.attack ||
    Number(p.markers["druid.vineCooldown"] ?? 0) > 0
  )
    return [];
  return [
    {
      offerId: `offer:${A}`,
      legalTargetRefs: calculateTargetOffer(s, seat, {
        kind: "character",
        min: 1,
        max: 1,
        distinct: true,
        includeSelf: true,
        team: "any",
        presence: "inPlay",
        maxDistance: 2,
      }).legalTargetRefs,
    },
  ];
}
export class VineSession {
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
    targetRef: string;
  }) {
    const p = this.#state.players.find((x) => x.userId === c.actorUserId),
      w = p
        ? this.#state.pendingWindows.find(
            (x) => x.promptId === c.promptId && x.prioritySeat === p.seat,
          )
        : undefined,
      o = p ? buildVineOffers(this.#state, this.r, p.seat)[0] : undefined;
    if (
      !p ||
      !w ||
      !o ||
      c.offerId !== o.offerId ||
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
      d = tx.draft.players.find((x) => x.seat === p.seat)!;
    tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
      (x) => x.promptId !== w.promptId,
    );
    d.markers["druid.vineCooldown"] = 2;
    createScriptedAttackInTransaction(tx, {
      attackId: `attack:vine:${tx.draft.stateRevision + 1}`,
      attackerSeat: p.seat,
      targetRef: c.targetRef,
      sourceRef: `character:${p.seat}`,
      weaponId: A,
      modeId: "vine",
      range: 2,
      attackTypes: ["ranged"],
      damageSegments: [
        {
          segmentId: "vine",
          deliveryType: "attack",
          attackType: "ranged",
          damageType: "normal",
          element: "poison",
          amount: 1,
          repeat: 1,
          isAdditional: false,
          overflowPolicy: "normal",
        },
      ],
      cannotMeleeBlock: true,
      ignoreArmor: true,
      resumePlayDeadlineAt: w.deadlineAt,
      tags: ["vineEntanglement"],
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
export function processVineAfter(c: TransactionCommit<AuthoritativeGameState>) {
  let s = c.state;
  const extra: DomainEvent[] = [];
  for (const e of c.events)
    if (e.eventType === "attack.target.after") {
      const d = e.payload as Record<string, unknown>,
        tags = Array.isArray(d.tags) ? d.tags : [];
      if (tags.includes("vineEntanglement") && d.hit === true) {
        const target = Number(String(d.targetRef).split(":")[1]) as Seat,
          tx = new EngineTransaction(s);
        addDrawCountModifierInTransaction(tx, {
          seat: target,
          modifierId: `druid.vine:${String(d.attackId)}`,
          sourceRef: `character:${String(d.attackerSeat)}`,
          delta: -2,
          remainingAffectedDraws: 1,
        });
        const out = tx.commit();
        s = out.state;
        extra.push(...out.events);
      }
    }
  return {
    previousRevision: c.previousRevision,
    state: s,
    events: [...c.events, ...extra],
  };
}
