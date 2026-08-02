import type { LoadedRuleset } from "../ruleset/types.js";
import { buildAttackOffer, commitAttack } from "./attack.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent } from "./types.js";
import { validateAuthoritativeState } from "./stateValidation.js";
const CHARACTER = "character.assassin",
  ABILITY = "skill.assassin.creed_kill";
const colors = (r: LoadedRuleset) =>
  new Map(
    (
      r.documents.get("cards.json") as {
        items: Array<{ cardId: string; color: string }>;
      }
    ).items.map((x) => [x.cardId, x.color]),
  );
export function buildAssassinCreedKillOffers(
  s: AuthoritativeGameState,
  r: LoadedRuleset,
  seat: Seat,
) {
  const p = s.players.find((x) => x.seat === seat),
    w = s.pendingWindows.find(
      (x) => x.kind === "playPhaseAction" && x.prioritySeat === seat,
    );
  if (
    p?.characterId !== CHARACTER ||
    !p.skillIds.includes(ABILITY) ||
    p.markers["assassin.creedKillUsed"] === true ||
    s.activeSeat !== seat ||
    s.phase !== "play" ||
    s.phaseBoundary !== "body" ||
    !w ||
    s.combat.attack
  )
    return [];
  let attack;
  try {
    attack = buildAttackOffer(s, seat, r);
  } catch {
    return [];
  }
  const map = colors(r),
    hand = s.zones[`hand:${seat}`]!.orderedCardRefs,
    pairs: string[][] = [];
  for (let i = 0; i < hand.length; i++)
    for (let j = i + 1; j < hand.length; j++)
      if (
        map.get(s.cards[hand[i]!]!.templateId) ===
        map.get(s.cards[hand[j]!]!.templateId)
      )
        pairs.push([hand[i]!, hand[j]!]);
  return attack.source.mode.costs.killCards === 1 &&
    attack.attackCountAvailable >= attack.attackCountCost &&
    pairs.length &&
    attack.targets.legalTargetRefs.length
    ? [
        {
          offerId: "offer:skill.assassin.creed_kill",
          stateRevision: s.stateRevision,
          legalCardPairs: pairs,
          legalTargetRefs: attack.targets.legalTargetRefs,
          targetMin: attack.targets.spec.min,
          targetMax: attack.targets.spec.max,
        },
      ]
    : [];
}
export interface AssassinCreedKillCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  cardRefs: string[];
  targetRefs: string[];
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
export class AssassinCreedKillSession {
  #state: AuthoritativeGameState;
  #results = new Map<string, Result>();
  constructor(
    state: AuthoritativeGameState,
    private r: LoadedRuleset,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  handle(c: AssassinCreedKillCommand): Result {
    const old = this.#results.get(c.commandId);
    if (old) return structuredClone(old);
    const reject = (reasonCode: string, refreshRequired: boolean): Result => {
      const x = {
        accepted: false as const,
        commandId: c.commandId,
        stateRevision: this.#state.stateRevision,
        reasonCode,
        refreshRequired,
      };
      this.#results.set(c.commandId, x);
      return structuredClone(x);
    };
    if (c.gameId !== this.#state.gameId) return reject("GAME_NOT_FOUND", false);
    if (c.expectedStateRevision !== this.#state.stateRevision)
      return reject("STALE_REVISION", true);
    const actor = this.#state.players.find((p) => p.userId === c.actorUserId),
      w = actor
        ? this.#state.pendingWindows.find(
            (x) =>
              x.promptId === c.promptId &&
              x.prioritySeat === actor.seat &&
              x.kind === "playPhaseAction",
          )
        : undefined,
      o = actor
        ? buildAssassinCreedKillOffers(this.#state, this.r, actor.seat)[0]
        : undefined;
    if (!actor || !w) return reject("NOT_YOUR_PRIORITY", false);
    if (!o || c.offerId !== o.offerId) return reject("OFFER_EXPIRED", true);
    if (
      c.cardRefs.length !== 2 ||
      !o.legalCardPairs.some((pair) =>
        pair.every((ref) => c.cardRefs.includes(ref)),
      )
    )
      return reject("COST_SELECTION_INVALID", false);
    if (
      c.targetRefs.length < o.targetMin ||
      c.targetRefs.length > o.targetMax ||
      new Set(c.targetRefs).size !== c.targetRefs.length ||
      c.targetRefs.some((ref) => !o.legalTargetRefs.includes(ref))
    )
      return reject("TARGET_SELECTION_INVALID", false);
    const armed = new EngineTransaction(this.#state),
      p = armed.draft.players.find((x) => x.seat === actor.seat)!;
    p.markers["assassin.creedKillUsed"] = true;
    p.markers["assassin.creedKillPendingNextTurn"] = true;
    armed.emit("ability.activation.committed", {
      seat: actor.seat,
      abilityId: ABILITY,
      cardRefs: c.cardRefs,
      treatedAs: "kill",
    });
    const paid = armed.commit();
    paid.state.history.domainEvents.push(...paid.events);
    const attack = commitAttack(paid.state, this.r, {
      attackerSeat: actor.seat,
      targetRefs: c.targetRefs,
      killCardRefs: c.cardRefs,
      killConversion: {
        abilityId: ABILITY,
        requiredPhysicalKillCount: 1,
        convertedCardCount: 2,
      },
    });
    validateAuthoritativeState(attack.state);
    this.#state = attack.state;
    const result = {
      accepted: true as const,
      commandId: c.commandId,
      previousRevision: paid.previousRevision,
      stateRevision: attack.state.stateRevision,
      events: [...paid.events, ...attack.events],
    };
    this.#results.set(c.commandId, result);
    return structuredClone(result);
  }
}
export function onAssassinOwnerTurnStart(
  tx: EngineTransaction<AuthoritativeGameState>,
  seat: Seat,
) {
  const p = tx.draft.players.find((x) => x.seat === seat)!;
  if (p.markers["assassin.creedKillPendingNextTurn"] !== true) return;
  delete p.markers["assassin.creedKillPendingNextTurn"];
  p.markers["assassin.creedKillDistanceActive"] = true;
  p.limits.offenseDistanceModifier =
    Number(p.limits.offenseDistanceModifier ?? 0) - 1;
  tx.emit("distance.modified", {
    seat,
    kind: "offense",
    delta: -1,
    reason: ABILITY,
  });
}
export function expireAssassinCreedKillAtTurnEnd(
  tx: EngineTransaction<AuthoritativeGameState>,
  seat: Seat,
) {
  const p = tx.draft.players.find((x) => x.seat === seat)!;
  if (p.markers["assassin.creedKillDistanceActive"] !== true) return;
  delete p.markers["assassin.creedKillDistanceActive"];
  p.limits.offenseDistanceModifier =
    Number(p.limits.offenseDistanceModifier ?? 0) + 1;
  tx.emit("distance.modified", {
    seat,
    kind: "offense",
    delta: 1,
    reason: `${ABILITY}.expiry`,
  });
}
export function resetAssassinCreedKillAtPrepare(
  tx: EngineTransaction<AuthoritativeGameState>,
  seat: Seat,
) {
  delete tx.draft.players.find((x) => x.seat === seat)!.markers[
    "assassin.creedKillUsed"
  ];
}
