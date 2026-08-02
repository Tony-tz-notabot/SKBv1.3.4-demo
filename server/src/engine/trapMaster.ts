import type { LoadedRuleset } from "../ruleset/types.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent, TransactionCommit } from "./types.js";
import { moveCardInTransaction } from "./zoneMovement.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { calculateTargetOffer } from "./targets.js";
import { createScriptedAttackInTransaction } from "./scriptedAttack.js";
const C = "character.trap_master",
  A = "skill.trap_master.bomber";
const window = (s: AuthoritativeGameState, n: Seat) =>
  s.pendingWindows.find(
    (w) => w.kind === "playPhaseAction" && w.prioritySeat === n,
  );
export function buildBomberOffers(
  s: AuthoritativeGameState,
  _r: LoadedRuleset,
  n: Seat,
) {
  const p = s.players.find((x) => x.seat === n),
    w = window(s, n),
    cards = s.zones[`hand:${n}`]?.orderedCardRefs ?? [];
  if (
    !p ||
    p.characterId !== C ||
    !p.skillIds.includes(A) ||
    s.activeSeat !== n ||
    s.phase !== "play" ||
    s.phaseBoundary !== "body" ||
    !w ||
    s.combat.attack ||
    cards.length < 1 ||
    Number(p.markers["trap.bomberCooldown"] ?? 0) > 0
  )
    return [];
  return [
    {
      offerId: `offer:${A}`,
      legalCardRefs: cards,
      min: 1,
      max: Math.min(5, cards.length),
    },
  ];
}
export interface BomberCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  cardRefs: string[];
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
export class BomberSession {
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
  handle(c: BomberCommand): Result {
    const no = (reasonCode: string, refreshRequired = false): Result => ({
      accepted: false,
      commandId: c.commandId,
      stateRevision: this.#state.stateRevision,
      reasonCode,
      refreshRequired,
    });
    if (c.gameId !== this.#state.gameId) return no("GAME_NOT_FOUND");
    if (c.expectedStateRevision !== this.#state.stateRevision)
      return no("STALE_REVISION", true);
    const p = this.#state.players.find((x) => x.userId === c.actorUserId),
      w = p ? window(this.#state, p.seat) : undefined,
      o = p ? buildBomberOffers(this.#state, this.r, p.seat)[0] : undefined;
    if (!p || !w || w.promptId !== c.promptId) return no("NOT_YOUR_PRIORITY");
    if (!o || c.offerId !== o.offerId) return no("OFFER_EXPIRED", true);
    if (
      c.cardRefs.length < o.min ||
      c.cardRefs.length > o.max ||
      new Set(c.cardRefs).size !== c.cardRefs.length ||
      c.cardRefs.some((x) => !o.legalCardRefs.includes(x))
    )
      return no("COST_SELECTION_INVALID");
    const tx = new EngineTransaction(this.#state),
      d = tx.draft.players.find((x) => x.seat === p.seat)!;
    for (const ref of c.cardRefs)
      moveCardInTransaction(tx, {
        cardRef: ref,
        toZoneRef: "discardPile",
        moveKind: "discard",
        faceUp: true,
      });
    d.markers["trap.bombs"] =
      Number(d.markers["trap.bombs"] ?? 0) + c.cardRefs.length;
    d.markers["trap.bomberCooldown"] = 3;
    tx.emit("ability.activation.committed", {
      seat: p.seat,
      abilityId: A,
      cardRefs: c.cardRefs,
      bombs: d.markers["trap.bombs"],
    });
    const out = tx.commit();
    out.state.history.domainEvents.push(...out.events);
    validateAuthoritativeState(out.state);
    this.#state = out.state;
    return {
      accepted: true,
      commandId: c.commandId,
      previousRevision: out.previousRevision,
      stateRevision: out.state.stateRevision,
      events: out.events,
    };
  }
}
export function tickTrapCooldown(
  tx: EngineTransaction<AuthoritativeGameState>,
  seat: Seat,
) {
  const p = tx.draft.players.find((x) => x.seat === seat)!,
    n = Number(p.markers["trap.bomberCooldown"] ?? 0);
  if (n > 0) {
    if (n === 1) delete p.markers["trap.bomberCooldown"];
    else p.markers["trap.bomberCooldown"] = n - 1;
  }
}
export function openBombDetonation(
  tx: EngineTransaction<AuthoritativeGameState>,
  seat: Seat,
  deadlineAt: number,
) {
  const p = tx.draft.players.find((x) => x.seat === seat)!,
    n = Number(p.markers["trap.bombs"] ?? 0);
  if (p.characterId !== C || n < 1) return false;
  const refs = calculateTargetOffer(tx.draft, seat, {
      kind: "character",
      min: 1,
      max: 1,
      distinct: true,
      includeSelf: true,
      team: "any",
      presence: "inPlay",
    }).legalTargetRefs,
    promptId = `prompt:trap-detonation:${tx.draft.stateRevision + 1}`;
  tx.draft.pendingWindows.push({
    promptId,
    kind: "trapBombDetonation",
    prioritySeat: seat,
    mandatory: false,
    deadlineAt,
    timeoutPolicy: "pass",
    legalOfferIds: [
      "offer:trap-detonation:pass",
      ...refs.map((x) => `offer:trap-detonation:${x}`),
    ],
    context: { bombs: n },
  });
  return true;
}
export class BombDetonationSession {
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
        (x) => x.kind === "trapBombDetonation" && x.promptId === c.promptId,
      ),
      p = this.#state.players.find((x) => x.userId === c.actorUserId);
    if (
      !w ||
      !p ||
      p.seat !== w.prioritySeat ||
      !w.legalOfferIds.includes(c.offerId)
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
      n = Number(d.markers["trap.bombs"] ?? 0);
    delete d.markers["trap.bombs"];
    tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
      (x) => x.promptId !== w.promptId,
    );
    if (!c.offerId.endsWith(":pass")) {
      const target = c.offerId.slice("offer:trap-detonation:".length);
      createScriptedAttackInTransaction(tx, {
        attackId: `attack:trap-detonation:${tx.draft.stateRevision + 1}`,
        attackerSeat: p.seat,
        targetRef: target,
        sourceRef: `character:${p.seat}`,
        weaponId: "skill.trap_master.bomb_detonation",
        modeId: "detonate",
        range: "unlimited",
        attackTypes: ["field"],
        damageSegments: Array.from({ length: n }, (_, i) => ({
          segmentId: `bomb.${i + 1}`,
          deliveryType: "attack",
          attackType: "field",
          damageType: "normal",
          element: "none",
          amount: 1,
          repeat: 1,
          isAdditional: false,
          overflowPolicy: "normal",
        })),
        ignoreArmor: true,
        tags: ["bombDetonation"],
      });
    }
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
export function grantBombsAfterAttack(
  c: TransactionCommit<AuthoritativeGameState>,
) {
  let s = c.state;
  const extra: DomainEvent[] = [];
  for (const e of c.events)
    if (e.eventType === "attack.target.after") {
      const d = e.payload as Record<string, unknown>,
        p = s.players.find((x) => x.seat === Number(d.attackerSeat));
      if (
        p?.characterId === C &&
        Number(d.actualHpLoss) > 0 &&
        Number(d.attackerSeat) !== Number(String(d.targetRef).split(":")[1])
      ) {
        const tx = new EngineTransaction(s),
          q = tx.draft.players.find((x) => x.seat === p.seat)!,
          attack = tx.draft.combat.attack as Record<string, unknown>,
          before = Number(attack.trapBombHpAccumulator ?? 0),
          after = before + Number(d.actualHpLoss),
          gain = Math.floor(after / 2) - Math.floor(before / 2);
        attack.trapBombHpAccumulator = after;
        if (gain) {
          q.markers["trap.bombs"] = Number(q.markers["trap.bombs"] ?? 0) + gain;
          tx.emit("marker.changed", {
            seat: p.seat,
            markerId: "trap.bombs",
            add: gain,
            value: q.markers["trap.bombs"],
          });
        }
        const o = tx.commit();
        s = o.state;
        extra.push(...o.events);
      }
    }
  return {
    previousRevision: c.previousRevision,
    state: s,
    events: [...c.events, ...extra],
  };
}
