import type { LoadedRuleset } from "../ruleset/types.js";
import { beginJudgment, type PrintedColor } from "./judgment.js";
import { openPreJudgmentWindow } from "./preJudgment.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import type { DomainEvent, JsonValue, TransactionCommit } from "./types.js";
import { EngineTransaction } from "./transaction.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { createScriptedAttackInTransaction } from "./scriptedAttack.js";

const CHARACTER = "character.demonmancer";
const TALENT = "talent.hellfire";
const payload = (event: DomainEvent): Record<string, JsonValue> =>
  event.payload &&
  typeof event.payload === "object" &&
  !Array.isArray(event.payload)
    ? event.payload
    : {};
function hellfireDefinition(ruleset: LoadedRuleset) {
  const document = ruleset.documents.get("character-rules.json") as {
      rules: Array<{
        ruleId: string;
        effects: Array<{ op: string; params?: Record<string, unknown> }>;
      }>;
    },
    rule = document.rules.find(
      (item) => item.ruleId === "character.demonmancer.hellfire",
    ),
    judge = rule?.effects.find((effect) => effect.op === "judgeColor")?.params,
    damage = rule?.effects.find(
      (effect) => effect.op === "createDamage",
    )?.params,
    match = Array.isArray(judge?.match)
      ? judge.match.filter(
          (x): x is PrintedColor =>
            typeof x === "string" &&
            ["white", "green", "blue", "orange", "red"].includes(x),
        )
      : [];
  if (
    !match.length ||
    !Number.isInteger(damage?.amount) ||
    damage?.element !== "fire"
  )
    throw new Error("DEMONMANCER_HELLFIRE_RULE_INVALID");
  return { match, amount: Number(damage.amount) };
}

export function processDemonmancerHellfireEvents(
  committed: TransactionCommit<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  deadlineAt: number,
): TransactionCommit<AuthoritativeGameState> {
  for (const event of committed.events) {
    if (event.eventType !== "attack.target.after") continue;
    const data = payload(event),
      attackerSeat = Number(data.attackerSeat) as Seat;
    const attacker = committed.state.players.find(
      (player) => player.seat === attackerSeat,
    );
    if (
      !attacker ||
      attacker.characterId !== CHARACTER ||
      !attacker.initialTalentIds.includes(TALENT) ||
      Number(data.actualDamage ?? 0) <= 0
    )
      continue;
    const definition = hellfireDefinition(ruleset),
      input = {
        controllerSeat: attackerSeat,
        sourceRef:
          typeof data.sourceRef === "string"
            ? data.sourceRef
            : `character:${attackerSeat}`,
        purpose: "demonmancerHellfire",
        matchColors: definition.match,
        context: {
          demonmancerHellfire: true,
          hellfireAmount: definition.amount,
          attackId: String(data.attackId),
          targetRef: String(data.targetRef),
          sourceSeat: attackerSeat,
        },
      };
    const opened =
      openPreJudgmentWindow(committed.state, ruleset, input, deadlineAt) ??
      beginJudgment(committed.state, ruleset, input, deadlineAt);
    const priorityKinds = new Set([
      "preJudgment",
      "judgmentIntervention",
      "judgmentDesignation",
    ]);
    if (
      opened.state.pendingWindows.some(
        (window, index) => priorityKinds.has(window.kind) && index > 0,
      )
    ) {
      const tx = new EngineTransaction(opened.state),
        prioritized = tx.draft.pendingWindows.filter((window) =>
          priorityKinds.has(window.kind),
        ),
        others = tx.draft.pendingWindows.filter(
          (window) => !priorityKinds.has(window.kind),
        );
      tx.draft.pendingWindows = [...prioritized, ...others];
      tx.emit("response.window.prioritized", {
        kind: "demonmancerHellfireJudgment",
        attackId: String(data.attackId),
        targetRef: String(data.targetRef),
      });
      const reordered = tx.commit();
      reordered.state.history.domainEvents.push(...reordered.events);
      validateAuthoritativeState(reordered.state);
      return {
        previousRevision: committed.previousRevision,
        state: reordered.state,
        events: [...committed.events, ...opened.events, ...reordered.events],
      };
    }
    return {
      previousRevision: committed.previousRevision,
      state: opened.state,
      events: [...committed.events, ...opened.events],
    };
  }
  return committed;
}

export const isPendingHellfireDamage = (state: AuthoritativeGameState) =>
  state.scheduledEffects.some(
    (item) =>
      item.executeAt === "immediate.damagePipeline" &&
      item.scheduledId.startsWith("scheduled:demonmancer-hellfire:"),
  );

type NatureRuntime = {
  targetCount: number;
  damage: number;
  damageType: string;
  element: string;
  attackType: string;
  range: number | "unlimited";
  ignoreArmor: boolean;
  cannotMeleeBlock: boolean;
  hpRecovery: number;
  maxShieldGain: number;
  durationOffset: number;
  ironShieldGain: number;
};
function natureDefinition(ruleset: LoadedRuleset): NatureRuntime {
  const document = ruleset.documents.get("character-rules.json") as {
      abilities: Array<{ abilityId: string; runtime?: NatureRuntime }>;
    },
    runtime = document.abilities.find(
      (item) => item.abilityId === "skill.demonmancer.demonic_nature",
    )?.runtime;
  if (
    !runtime ||
    runtime.targetCount !== 2 ||
    !Number.isInteger(runtime.damage) ||
    runtime.damage < 0 ||
    !Number.isInteger(runtime.durationOffset) ||
    !Number.isInteger(runtime.ironShieldGain)
  )
    throw new Error("DEMONMANCER_NATURE_RULE_INVALID");
  return runtime;
}
const ccw = (source: Seat, refs: string[]) =>
  [...refs].sort(
    (a, b) =>
      ((Number(a.split(":")[1]) - source + 4) % 4) -
      ((Number(b.split(":")[1]) - source + 4) % 4),
  );
export function buildDemonicNatureOffers(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  seat: Seat,
) {
  const d = natureDefinition(ruleset),
    player = state.players.find((p) => p.seat === seat),
    window = state.pendingWindows.find(
      (w) => w.kind === "playPhaseAction" && w.prioritySeat === seat,
    ),
    legalTargetRefs = state.players
      .filter((p) => p.presence === "inPlay" && p.lifeState !== "eliminated")
      .map((p) => `character:${p.seat}`);
  return player?.characterId === CHARACTER &&
    player.skillIds.includes("skill.demonmancer.demonic_nature") &&
    player.markers["demonmancer.natureUsed"] !== true &&
    state.activeSeat === seat &&
    state.phase === "play" &&
    state.phaseBoundary === "body" &&
    window &&
    Number(player.limits[ruleset.settings.combat.attackCountLimitId] ?? 0) >
      0 &&
    legalTargetRefs.length >= d.targetCount &&
    !state.combat.attack
    ? [
        {
          offerId: "offer:skill.demonmancer.demonic_nature",
          stateRevision: state.stateRevision,
          legalTargetRefs,
          targetCount: d.targetCount,
        },
      ]
    : [];
}
export interface DemonicNatureCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  targetRefs: string[];
}
type NatureResult =
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
export class DemonicNatureSession {
  #state: AuthoritativeGameState;
  #results = new Map<string, NatureResult>();
  constructor(
    state: AuthoritativeGameState,
    private ruleset: LoadedRuleset,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  handle(c: DemonicNatureCommand): NatureResult {
    const prior = this.#results.get(c.commandId);
    if (prior) return structuredClone(prior);
    const reject = (
      reasonCode: string,
      refreshRequired: boolean,
    ): NatureResult => {
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
        ? buildDemonicNatureOffers(this.#state, this.ruleset, actor.seat)[0]
        : undefined;
    if (!actor || !window) return reject("NOT_YOUR_PRIORITY", false);
    if (!offer || c.offerId !== offer.offerId)
      return reject("OFFER_EXPIRED", true);
    if (
      c.targetRefs.length !== offer.targetCount ||
      new Set(c.targetRefs).size !== offer.targetCount ||
      c.targetRefs.some((ref) => !offer.legalTargetRefs.includes(ref))
    )
      return reject("TARGET_SELECTION_INVALID", false);
    const d = natureDefinition(this.ruleset),
      tx = new EngineTransaction(this.#state),
      draft = tx.draft,
      player = draft.players.find((p) => p.seat === actor.seat)!,
      spent = Number(
        player.limits[this.ruleset.settings.combat.attackCountLimitId],
      ),
      ordered = ccw(actor.seat, c.targetRefs),
      segment = {
        segmentId: "demonmancer.flameBurn",
        deliveryType: "attack",
        attackType: d.attackType,
        damageType: d.damageType,
        element: d.element,
        amount: d.damage,
        repeat: 1,
        isAdditional: false,
        overflowPolicy: "normal",
      };
    draft.pendingWindows = draft.pendingWindows.filter(
      (w) => w.promptId !== window.promptId,
    );
    player.limits[this.ruleset.settings.combat.attackCountLimitId] = 0;
    player.markers["demonmancer.natureUsed"] = true;
    createScriptedAttackInTransaction(tx, {
      attackId: `attack:demonic-nature:${draft.stateRevision + 1}:1`,
      attackerSeat: actor.seat,
      sourceRef: `character:${actor.seat}`,
      weaponId: "skill.demonmancer.demonic_nature",
      modeId: "flameBurn",
      targetRef: ordered[0]!,
      range: d.range,
      attackTypes: [d.attackType],
      damageSegments: [segment],
      cannotMeleeBlock: d.cannotMeleeBlock,
      ignoreArmor: d.ignoreArmor,
      resumePlayDeadlineAt: window.deadlineAt,
      tags: ["demonicNature"],
    });
    const first = draft.combat.attack as Record<string, JsonValue>,
      second = structuredClone(first);
    second.attackId = `attack:demonic-nature:${draft.stateRevision + 1}:2`;
    second.targetRefs = [ordered[1]!];
    second.status = "committed";
    delete second.resumePlayDeadlineAt;
    first.afterAttackQueue = [second];
    first.demonNatureRewardPending = true;
    first.demonNatureSpentAttackCount = spent;
    first.demonNatureHpRecovery = d.hpRecovery;
    first.demonNatureMaxShieldGain = d.maxShieldGain;
    first.demonNatureDurationCount = spent + d.durationOffset;
    first.demonNatureIronShieldGain = d.ironShieldGain;
    second.demonNatureRewardPending = true;
    second.demonNatureSpentAttackCount = spent;
    second.demonNatureHpRecovery = d.hpRecovery;
    second.demonNatureMaxShieldGain = d.maxShieldGain;
    second.demonNatureDurationCount = spent + d.durationOffset;
    second.demonNatureIronShieldGain = d.ironShieldGain;
    tx.emit("ability.activation.committed", {
      seat: actor.seat,
      abilityId: "skill.demonmancer.demonic_nature",
      targetRefs: ordered,
      spentAttackCount: spent,
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

export function processDemonicNatureTargetAfterEvents(
  committed: TransactionCommit<AuthoritativeGameState>,
): TransactionCommit<AuthoritativeGameState> {
  let state = committed.state;
  const extra: DomainEvent[] = [];
  for (const event of committed.events) {
    if (event.eventType !== "attack.target.after") continue;
    const data = payload(event),
      tags = Array.isArray(data.tags) ? data.tags : [];
    if (!tags.includes("demonicNature") || data.hit !== true) continue;
    const sourceSeat = Number(data.attackerSeat) as Seat,
      targetSeat = Number(String(data.targetRef).split(":")[1]) as Seat,
      duration = Number(data.demonNatureDurationCount ?? 0),
      gain = Number(data.demonNatureIronShieldGain ?? 0),
      tx = new EngineTransaction(state),
      target = tx.draft.players.find((p) => p.seat === targetSeat)!,
      source = tx.draft.players.find((p) => p.seat === sourceSeat)!;
    target.markers[`demonmancer.noShieldRecovery.${sourceSeat}`] = Math.max(
      Number(target.markers[`demonmancer.noShieldRecovery.${sourceSeat}`] ?? 0),
      duration,
    );
    if (source.markers["demonmancer.natureIronActive"] !== true) {
      source.markers["demonmancer.natureIronActive"] = true;
      source.markers["demonmancer.natureIronRemainingPrepares"] = duration;
      source.markers["demonmancer.natureIronContribution"] = gain;
      source.ironShield += gain;
      tx.emit("ironShield.changed", {
        seat: sourceSeat,
        add: gain,
        value: source.ironShield,
        sourceId: "skill.demonmancer.demonic_nature",
      });
    }
    tx.emit("restriction.applied", {
      seat: targetSeat,
      restrictionId: "noAutomaticShieldRecovery",
      remainingPrepares: duration,
      sourceSeat,
    });
    const out = tx.commit();
    out.state.history.domainEvents.push(...out.events);
    state = out.state;
    extra.push(...out.events);
  }
  return {
    previousRevision: committed.previousRevision,
    state,
    events: [...committed.events, ...extra],
  };
}
export function tickDemonmancerPrepareDurations(
  tx: EngineTransaction<AuthoritativeGameState>,
  seat: Seat,
) {
  const p = tx.draft.players.find((x) => x.seat === seat)!;
  const restrictions = Object.keys(p.markers).filter(
    (key) =>
      key.startsWith("demonmancer.noShieldRecovery.") &&
      Number(p.markers[key]) > 0,
  );
  if (restrictions.length)
    p.markers["demonmancer.skipShieldRecoveryThisPrepare"] = true;
  for (const key of restrictions) {
    const left = Number(p.markers[key] ?? 0) - 1;
    if (left > 0) p.markers[key] = left;
    else delete p.markers[key];
    tx.emit("duration.ticked", {
      seat,
      durationId: key,
      remainingCount: Math.max(0, left),
    });
  }
  const iron = Number(
    p.markers["demonmancer.natureIronRemainingPrepares"] ?? 0,
  );
  if (iron > 0) {
    const left = iron - 1;
    if (left > 0) p.markers["demonmancer.natureIronRemainingPrepares"] = left;
    else {
      const contribution = Number(
        p.markers["demonmancer.natureIronContribution"] ?? 0,
      );
      p.ironShield = Math.max(0, p.ironShield - contribution);
      delete p.markers["demonmancer.natureIronRemainingPrepares"];
      delete p.markers["demonmancer.natureIronContribution"];
      delete p.markers["demonmancer.natureIronActive"];
      tx.emit("ironShield.changed", {
        seat,
        add: -contribution,
        value: p.ironShield,
        sourceId: "skill.demonmancer.demonic_nature.expiry",
      });
    }
  }
}
export const hasDemonmancerShieldRecoveryRestriction = (
  state: AuthoritativeGameState,
  seat: Seat,
) =>
  state.players.find((p) => p.seat === seat)!.markers[
    "demonmancer.skipShieldRecoveryThisPrepare"
  ] === true;
