import type { LoadedRuleset } from "../ruleset/types.js";
import { createCompositeScriptedAttackInTransaction } from "./scriptedAttack.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent, JsonValue } from "./types.js";
import { moveCardInTransaction } from "./zoneMovement.js";
import { validateAuthoritativeState } from "./stateValidation.js";
const CHARACTER = "character.robot",
  ABILITY = "skill.robot.energy_overload";
type Runtime = {
  discardHandCount: number;
  damage: number;
  damageType: string;
  element: string;
  attackType: string;
  range: number | "unlimited";
  ignoreTalentModifiers: boolean;
  ignoreArmor: boolean;
  cannotMeleeBlock: boolean;
};
function definition(r: LoadedRuleset): Runtime {
  const d = r.documents.get("character-rules.json") as {
      abilities: Array<{ abilityId: string; runtime?: Runtime }>;
    },
    x = d.abilities.find((a) => a.abilityId === ABILITY)?.runtime;
  if (!x || x.discardHandCount < 1 || x.damage < 0 || x.attackType !== "laser")
    throw new Error("ROBOT_OVERLOAD_RULE_INVALID");
  return x;
}
const turnKey = (s: AuthoritativeGameState) => `${s.round}:${s.activeSeat}`;
export function buildRobotOverloadOffers(
  s: AuthoritativeGameState,
  r: LoadedRuleset,
  seat: Seat,
) {
  const d = definition(r),
    p = s.players.find((x) => x.seat === seat),
    w = s.pendingWindows.find(
      (x) => x.kind === "playPhaseAction" && x.prioritySeat === seat,
    ),
    legalCardRefs = [...s.zones[`hand:${seat}`]!.orderedCardRefs],
    targetRefs = s.players
      .filter(
        (x) =>
          x.seat !== seat &&
          x.presence === "inPlay" &&
          x.lifeState !== "eliminated",
      )
      .sort((a, b) => ((a.seat - seat + 4) % 4) - ((b.seat - seat + 4) % 4))
      .map((x) => `character:${x.seat}`);
  return p?.characterId === CHARACTER &&
    p.skillIds.includes(ABILITY) &&
    s.activeSeat === seat &&
    s.phase === "play" &&
    s.phaseBoundary === "body" &&
    w &&
    !s.combat.attack &&
    p.markers["robot.overloadTurnKey"] !== turnKey(s) &&
    legalCardRefs.length >= d.discardHandCount &&
    targetRefs.length
    ? [
        {
          offerId: "offer:skill.robot.energy_overload",
          stateRevision: s.stateRevision,
          legalCardRefs,
          requiredCardCount: d.discardHandCount,
          targetRefs,
        },
      ]
    : [];
}
export interface RobotOverloadCommand {
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
export class RobotOverloadSession {
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
  handle(c: RobotOverloadCommand): Result {
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
        ? buildRobotOverloadOffers(this.#state, this.r, actor.seat)[0]
        : undefined;
    if (!actor || !w) return reject("NOT_YOUR_PRIORITY", false);
    if (!o || c.offerId !== o.offerId) return reject("OFFER_EXPIRED", true);
    if (
      c.cardRefs.length !== o.requiredCardCount ||
      new Set(c.cardRefs).size !== o.requiredCardCount ||
      c.cardRefs.some((ref) => !o.legalCardRefs.includes(ref))
    )
      return reject("COST_SELECTION_INVALID", false);
    const d = definition(this.r),
      tx = new EngineTransaction(this.#state),
      p = tx.draft.players.find((x) => x.seat === actor.seat)!;
    tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
      (x) => x.promptId !== w.promptId,
    );
    for (const ref of c.cardRefs)
      moveCardInTransaction(tx, {
        cardRef: ref,
        toZoneRef: "resolving",
        moveKind: "discard",
        faceUp: true,
      });
    p.markers["robot.overloadTurnKey"] = turnKey(tx.draft);
    const segment = {
      segmentId: "robot.energyOverload",
      deliveryType: "attack",
      attackType: d.attackType,
      damageType: d.damageType,
      element: d.element,
      amount: d.damage,
      repeat: 1,
      isAdditional: false,
      overflowPolicy: "normal",
    };
    createCompositeScriptedAttackInTransaction(tx, {
      attackId: `attack:robot-overload:${tx.draft.stateRevision + 1}`,
      attackerSeat: actor.seat,
      sourceRef: `character:${actor.seat}`,
      weaponId: ABILITY,
      modeId: "energyOverload",
      range: d.range,
      targetGroups: o.targetRefs.map((targetRef) => ({
        targetRef,
        attackTypes: [d.attackType],
        damageSegments: [segment as unknown as JsonValue],
        cannotMeleeBlock: d.cannotMeleeBlock,
      })),
      ignoreArmor: d.ignoreArmor,
      ignoreTalentModifiers: d.ignoreTalentModifiers,
      resumePlayDeadlineAt: w.deadlineAt,
      costCardRefs: c.cardRefs,
      tags: ["robotEnergyOverload"],
      preserveTargetOrder: true,
    });
    tx.emit("ability.activation.committed", {
      seat: actor.seat,
      abilityId: ABILITY,
      cardRefs: c.cardRefs,
      targetRefs: o.targetRefs,
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
