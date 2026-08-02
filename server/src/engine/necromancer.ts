import type { LoadedRuleset } from "../ruleset/types.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent, JsonValue } from "./types.js";
import { validateAuthoritativeState } from "./stateValidation.js";

const CHARACTER = "character.necromancer",
  TALENT = "talent.soul_strike",
  ABILITY = "skill.necromancer.mark",
  MARKER = "necromancer.mark";
type Runtime = {
  energyCost: number;
  energyCap: number;
  ironShieldContribution: number;
  extraDamageCap: number;
  sourcePrepareCount: number;
};
function definition(ruleset: LoadedRuleset): Runtime {
  const document = ruleset.documents.get("character-rules.json") as {
      abilities: Array<{ abilityId: string; runtime?: Runtime }>;
    },
    runtime = document.abilities.find((x) => x.abilityId === ABILITY)?.runtime;
  if (
    !runtime ||
    runtime.ironShieldContribution >= 0 ||
    runtime.energyCost < 0 ||
    runtime.energyCap < runtime.energyCost ||
    runtime.extraDamageCap < 0 ||
    runtime.sourcePrepareCount < 1
  )
    throw new Error("NECROMANCER_MARK_RULE_INVALID");
  return runtime;
}
type Mark = {
  sourceSeat: Seat;
  remainingSourcePrepares: number;
  extraDamageAccumulated: number;
  contributionActive: boolean;
};
const markOf = (
  state: AuthoritativeGameState,
  targetSeat: Seat,
): Mark | null => {
  const value = state.players.find((p) => p.seat === targetSeat)!.markers[
    MARKER
  ];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as unknown as Mark)
    : null;
};
export function necromancerMarkExtraPotential(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  targetSeat: Seat,
  proposedDamage: number,
  finalDamage: number,
  prevented: boolean,
) {
  const mark = markOf(state, targetSeat),
    d = definition(ruleset);
  if (
    !mark?.contributionActive ||
    mark.extraDamageAccumulated >= d.extraDamageCap ||
    prevented ||
    proposedDamage <= 0
  )
    return 0;
  const player = state.players.find((p) => p.seat === targetSeat)!,
    withoutMark = Math.max(
      0,
      proposedDamage - (player.ironShield - d.ironShieldContribution),
    );
  return Math.max(
    0,
    Math.min(
      d.extraDamageCap - mark.extraDamageAccumulated,
      finalDamage - withoutMark,
    ),
  );
}
export function recordNecromancerAppliedDamage(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  input: {
    sourceSeat: Seat | null;
    targetSeat: Seat;
    actualDamage: number;
    markExtraActual: number;
  },
) {
  const d = definition(ruleset),
    mark = markOf(tx.draft, input.targetSeat);
  if (mark && input.markExtraActual > 0) {
    mark.extraDamageAccumulated = Math.min(
      d.extraDamageCap,
      mark.extraDamageAccumulated + input.markExtraActual,
    );
    if (
      mark.extraDamageAccumulated >= d.extraDamageCap &&
      mark.contributionActive
    ) {
      const target = tx.draft.players.find((p) => p.seat === input.targetSeat)!;
      target.ironShield -= d.ironShieldContribution;
      mark.contributionActive = false;
      tx.emit("ironShield.changed", {
        seat: input.targetSeat,
        add: -d.ironShieldContribution,
        value: target.ironShield,
        sourceId: `${ABILITY}.capReached`,
      });
    }
    tx.emit("counter.changed", {
      seat: input.targetSeat,
      counterId: "necromancer.mark.extraDamage",
      to: mark.extraDamageAccumulated,
      max: d.extraDamageCap,
      sourceSeat: mark.sourceSeat,
    });
  }
  if (input.sourceSeat) {
    const source = tx.draft.players.find((p) => p.seat === input.sourceSeat)!;
    if (
      source.characterId === CHARACTER &&
      source.initialTalentIds.includes(TALENT)
    ) {
      const gain = Math.max(0, input.actualDamage - input.markExtraActual),
        before = Number(source.markers["necromancer.energy"] ?? 0),
        after = Math.min(d.energyCap, before + gain);
      source.markers["necromancer.energy"] = after;
      if (after !== before)
        tx.emit("resource.changed", {
          seat: input.sourceSeat,
          resourceId: "necromancer.energy",
          from: before,
          to: after,
          reason: TALENT,
        });
    }
  }
}
export function buildNecromancerMarkOffers(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  seat: Seat,
) {
  const d = definition(ruleset),
    player = state.players.find((p) => p.seat === seat),
    window = state.pendingWindows.find(
      (w) => w.kind === "playPhaseAction" && w.prioritySeat === seat,
    ),
    legalTargetRefs = state.players
      .filter((p) => p.presence === "inPlay" && p.lifeState !== "eliminated")
      .map((p) => `character:${p.seat}`);
  return player?.characterId === CHARACTER &&
    player.skillIds.includes(ABILITY) &&
    state.activeSeat === seat &&
    state.phase === "play" &&
    state.phaseBoundary === "body" &&
    window &&
    !state.combat.attack &&
    Number(player.markers["necromancer.energy"] ?? 0) >= d.energyCost
    ? [
        {
          offerId: "offer:skill.necromancer.mark",
          stateRevision: state.stateRevision,
          legalTargetRefs,
        },
      ]
    : [];
}
export interface NecromancerMarkCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
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
export class NecromancerMarkSession {
  #state: AuthoritativeGameState;
  #results = new Map<string, Result>();
  constructor(
    state: AuthoritativeGameState,
    private ruleset: LoadedRuleset,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  handle(c: NecromancerMarkCommand): Result {
    const prior = this.#results.get(c.commandId);
    if (prior) return structuredClone(prior);
    const reject = (reasonCode: string, refreshRequired: boolean): Result => {
      const r = {
        accepted: false as const,
        commandId: c.commandId,
        stateRevision: this.#state.stateRevision,
        reasonCode,
        refreshRequired,
      };
      this.#results.set(c.commandId, r);
      return structuredClone(r);
    };
    if (c.gameId !== this.#state.gameId) return reject("GAME_NOT_FOUND", false);
    if (c.expectedStateRevision !== this.#state.stateRevision)
      return reject("STALE_REVISION", true);
    const actor = this.#state.players.find((p) => p.userId === c.actorUserId),
      window = actor
        ? this.#state.pendingWindows.find(
            (w) =>
              w.promptId === c.promptId &&
              w.kind === "playPhaseAction" &&
              w.prioritySeat === actor.seat,
          )
        : undefined,
      offer = actor
        ? buildNecromancerMarkOffers(this.#state, this.ruleset, actor.seat)[0]
        : undefined;
    if (!actor || !window) return reject("NOT_YOUR_PRIORITY", false);
    if (!offer || c.offerId !== offer.offerId)
      return reject("OFFER_EXPIRED", true);
    if (!offer.legalTargetRefs.includes(c.targetRef))
      return reject("TARGET_SELECTION_INVALID", false);
    const d = definition(this.ruleset),
      targetSeat = Number(c.targetRef.split(":")[1]) as Seat,
      tx = new EngineTransaction(this.#state),
      source = tx.draft.players.find((p) => p.seat === actor.seat)!,
      target = tx.draft.players.find((p) => p.seat === targetSeat)!,
      existing = markOf(tx.draft, targetSeat);
    tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
      (w) => w.promptId !== window.promptId,
    );
    source.markers["necromancer.energy"] =
      Number(source.markers["necromancer.energy"]) - d.energyCost;
    if (!existing?.contributionActive)
      target.ironShield += d.ironShieldContribution;
    target.markers[MARKER] = {
      sourceSeat: actor.seat,
      remainingSourcePrepares: d.sourcePrepareCount,
      extraDamageAccumulated: 0,
      contributionActive: true,
    } as unknown as JsonValue;
    tx.emit("resource.changed", {
      seat: actor.seat,
      resourceId: "necromancer.energy",
      to: source.markers["necromancer.energy"],
      cost: d.energyCost,
    });
    tx.emit(existing ? "status.refreshed" : "status.applied", {
      statusId: "status.necromancerMark",
      ownerSeat: targetSeat,
      sourceSeat: actor.seat,
      ironShieldContribution: d.ironShieldContribution,
      remainingSourcePrepares: d.sourcePrepareCount,
    });
    tx.emit("ability.activation.committed", {
      seat: actor.seat,
      abilityId: ABILITY,
      targetRef: c.targetRef,
    });
    tx.draft.pendingWindows.push({
      promptId: `prompt:playPhaseAction:${tx.draft.round}:${actor.seat}:${tx.draft.stateRevision + 1}`,
      kind: "playPhaseAction",
      prioritySeat: actor.seat,
      mandatory: false,
      deadlineAt: window.deadlineAt,
      timeoutPolicy: "pass",
      legalOfferIds: ["offer:playPhaseAction:finish"],
      context: {},
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
export function tickNecromancerMarksAtPrepare(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  sourceSeat: Seat,
) {
  const d = definition(ruleset);
  for (const target of tx.draft.players) {
    const mark = markOf(tx.draft, target.seat);
    if (!mark || mark.sourceSeat !== sourceSeat) continue;
    mark.remainingSourcePrepares -= 1;
    if (mark.remainingSourcePrepares > 0) {
      tx.emit("duration.ticked", {
        durationId: "necromancer.mark",
        sourceSeat,
        targetSeat: target.seat,
        remainingCount: mark.remainingSourcePrepares,
      });
      continue;
    }
    if (mark.contributionActive) {
      target.ironShield -= d.ironShieldContribution;
      tx.emit("ironShield.changed", {
        seat: target.seat,
        add: -d.ironShieldContribution,
        value: target.ironShield,
        sourceId: `${ABILITY}.expiry`,
      });
    }
    delete target.markers[MARKER];
    tx.emit("status.expired", {
      statusId: "status.necromancerMark",
      ownerSeat: target.seat,
      sourceSeat,
      reason: "source.secondSubsequentPrepare.before",
    });
  }
}
