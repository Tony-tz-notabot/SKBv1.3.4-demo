import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { commitAttack } from "./attack.js";
import { runCombatUntilBlocked } from "./combatScheduler.js";
import { resolveCurrentAttackTarget } from "./damage.js";
import { finalizeJudgment } from "./judgment.js";
import { setWeaponPreselection } from "./preselection.js";
import { AttackResponseSession, openAttackResponse } from "./response.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";
let ruleset: LoadedRuleset;
const users = { 1: "u1", 2: "u2", 3: "u3", 4: "u4" } as const,
  characters = {
    1: "character.knight",
    2: "character.alchemist",
    3: "character.ranger",
    4: "character.wizard",
  } as const;
beforeAll(async () => {
  ruleset = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});
function relocate(state: AuthoritativeGameState, ref: string, to: string) {
  const card = state.cards[ref]!,
    from = state.zones[card.zoneRef]!;
  from.orderedCardRefs.splice(from.orderedCardRefs.indexOf(ref), 1);
  state.zones[to]!.orderedCardRefs.push(ref);
  card.zoneRef = to;
  card.ownerSeat = state.zones[to]!.ownerSeat;
  card.controllerSeat = state.zones[to]!.ownerSeat;
  card.faceUp = !["drawPile", "hand"].includes(state.zones[to]!.zoneType);
}
function refFor(state: AuthoritativeGameState, prefix: string) {
  return Object.values(state.cards).find((card) =>
    card.templateId.startsWith(prefix),
  )!.cardRef;
}
function hitState() {
  let state = createInitialSetup(ruleset, {
    gameId: "damage",
    firstSeat: 1,
    seed: 27,
    usersBySeat: users,
    characterIdsBySeat: characters,
  });
  for (const seat of [1, 2, 3, 4] as const)
    state = resolveInitialRedraw(state, seat, false, ruleset).state;
  state.phase = "play";
  state.phaseMode = "manual";
  state.players[0]!.limits.attackCountRemaining = 1;
  const kill = refFor(state, "basic.kill.");
  relocate(state, kill, "hand:1");
  state = setWeaponPreselection(state, 1, "weapon:1:1", null, ruleset).state;
  state = commitAttack(state, ruleset, {
    attackerSeat: 1,
    targetRefs: ["character:2"],
    killCardRefs: [kill],
  }).state;
  state = openAttackResponse(state, ruleset, 500).state;
  const window = state.pendingWindows[0]!,
    session = new AttackResponseSession(state);
  session.handle({
    commandId: "pass",
    gameId: state.gameId,
    expectedStateRevision: state.stateRevision,
    actorUserId: "u2",
    promptId: window.promptId,
    offerId: window.legalOfferIds.find((id) => id.includes(":pass:"))!,
  });
  return session.state;
}
describe("damage segments", () => {
  it("routes normal damage through shield then hp and cleans up the attack", () => {
    const state = hitState(),
      target = state.players[1]!,
      attack = state.combat.attack as Record<string, unknown>;
    target.shield = 1;
    target.hp = 5;
    attack.resumePlayDeadlineAt = 900;
    const result = resolveCurrentAttackTarget(state);
    expect(result.state.players[1]).toMatchObject({ shield: 0, hp: 4 });
    expect(result.state.players[1]!.markers.shieldBroken).toBe(true);
    expect(result.state.combat.attack).toBeNull();
    expect(result.state.pendingWindows[0]).toMatchObject({
      kind: "playPhaseAction",
      deadlineAt: 900,
    });
    expect(result.events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        "damage.received",
        "shield.broken",
        "attack.resolved",
      ]),
    );
  });
  it("applies iron shield per segment and suppresses received at zero", () => {
    const state = hitState();
    state.players[1]!.ironShield = 2;
    const before = {
        hp: state.players[1]!.hp,
        shield: state.players[1]!.shield,
      },
      result = resolveCurrentAttackTarget(state);
    expect(result.state.players[1]).toMatchObject(before);
    expect(result.events.map((event) => event.eventType)).not.toContain(
      "damage.received",
    );
  });
  it("emits received without actual loss for death without elimination", () => {
    const state = hitState();
    state.players[1]!.lifeState = "deadNotEliminated";
    state.players[1]!.hp = null;
    state.players[1]!.shield = null;
    const result = resolveCurrentAttackTarget(state),
      event = result.events.find(
        (item) => item.eventType === "damage.received",
      );
    expect(event?.payload).toMatchObject({
      actualDamage: 0,
      actualHpLoss: 0,
      actualShieldLoss: 0,
      deadWithoutBars: true,
    });
  });
  it("pauses the attack and enters dying before any next target", () => {
    const state = hitState();
    state.players[1]!.shield = 0;
    state.players[1]!.hp = 1;
    const result = resolveCurrentAttackTarget(state);
    expect(result.state.players[1]).toMatchObject({
      hp: -1,
      lifeState: "dying",
    });
    expect(result.state.combat.dyingStack).toEqual(["character:2"]);
    expect(result.state.combat.attack).toMatchObject({
      status: "awaitingDying",
    });
  });
  it("learns elemental adaptations after the first attack and reduces each adapted element once per later attack", () => {
    const prepare = (adapted: boolean) => {
      const state = hitState(),
        target = state.players[1]!,
        attack = state.combat.attack as Record<string, unknown>;
      target.initialTalentIds = ["talent.adaptive_evolution"];
      target.shield = 20;
      target.hp = 20;
      if (adapted) {
        target.markers["druid.adaptation.fire"] = true;
        target.markers["druid.adaptation.poison"] = true;
      }
      attack.damageSegments = [
        {
          segmentId: "fire",
          damageType: "normal",
          element: "fire",
          amount: 1,
          repeat: 2,
        },
        {
          segmentId: "poison",
          damageType: "normal",
          element: "poison",
          amount: 1,
          repeat: 2,
        },
      ];
      return state;
    };
    const first = resolveCurrentAttackTarget(prepare(false));
    expect(first.state.players[1]).toMatchObject({
      shield: 16,
      markers: {
        "druid.adaptation.fire": true,
        "druid.adaptation.poison": true,
      },
    });
    expect(
      first.events.filter(
        (event) =>
          event.eventType === "damage.modified" &&
          String((event.payload as Record<string, unknown>).reason).includes(
            "adaptive_evolution",
          ),
      ),
    ).toHaveLength(0);
    const later = resolveCurrentAttackTarget(prepare(true));
    expect(later.state.players[1]!.shield).toBe(18);
    expect(
      later.events.filter(
        (event) =>
          event.eventType === "damage.modified" &&
          String((event.payload as Record<string, unknown>).reason).includes(
            "adaptive_evolution",
          ),
      ),
    ).toHaveLength(2);
  });
  it("keeps initial fire immunity effective while ordinary equipment effects are disabled", () => {
    const prepare = (disabled: boolean) => {
      const state = hitState(),
        target = state.players[1]!,
        attack = state.combat.attack as Record<string, unknown>;
      target.initialTalentIds.push("talent.fire_shield");
      target.shield = 10;
      target.markers.equipmentEffectsDisabled = disabled;
      attack.damageSegments = [
        {
          segmentId: "fire",
          damageType: "normal",
          element: "fire",
          amount: 2,
          repeat: 1,
        },
      ];
      return state;
    };
    const active = resolveCurrentAttackTarget(prepare(false));
    expect(active.state.players[1]!.shield).toBe(10);
    expect(
      active.events.find((event) => event.eventType === "damage.prevented")
        ?.payload,
    ).toMatchObject({ reason: "elementImmunity", element: "fire" });
    const disabled = resolveCurrentAttackTarget(prepare(true));
    expect(disabled.state.players[1]!.shield).toBe(10);
  });
  it("adds one fire or poison repeat per target and attack from the matching shield talent", () => {
    const prepare = (element: "fire" | "poison", talentId: string) => {
      const state = hitState(),
        attacker = state.players[0]!,
        target = state.players[1]!,
        attack = state.combat.attack as Record<string, unknown>;
      attacker.initialTalentIds = [talentId];
      target.initialTalentIds = [];
      target.shield = 10;
      attack.damageSegments = [
        {
          segmentId: element,
          damageType: "normal",
          element,
          amount: 1,
          repeat: 2,
        },
      ];
      return state;
    };
    const fire = resolveCurrentAttackTarget(
      prepare("fire", "talent.fire_shield"),
    );
    expect(fire.state.players[1]!.shield).toBe(7);
    expect(
      fire.events.find(
        (event) => event.eventType === "attack.elementRepeat.modified",
      )?.payload,
    ).toMatchObject({ element: "fire", from: 2, to: 3 });
    const poison = resolveCurrentAttackTarget(
      prepare("poison", "talent.poison_shield"),
    );
    expect(poison.state.players[1]!.shield).toBe(7);
  });
  it("places electric shield and elemental burst total bonuses into only the first positive repeat", () => {
    const prepare = (talentIds: string[], element: "fire" | "electric") => {
      const state = hitState(),
        attacker = state.players[0]!,
        target = state.players[1]!,
        attack = state.combat.attack as Record<string, unknown>;
      attacker.initialTalentIds = talentIds;
      target.initialTalentIds = [];
      target.shield = 10;
      attack.damageSegments = [
        {
          segmentId: element,
          damageType: "normal",
          element,
          amount: 1,
          repeat: 2,
        },
      ];
      return state;
    };
    const burst = resolveCurrentAttackTarget(
      prepare(["talent.elemental_burst"], "fire"),
    );
    expect(burst.state.players[1]!.shield).toBe(7);
    expect(
      burst.events.filter(
        (event) =>
          event.eventType === "damage.modified" &&
          (event.payload as Record<string, unknown>).reason ===
            "offensiveElementTotalBonus",
      ),
    ).toHaveLength(1);
    const electric = resolveCurrentAttackTarget(
      prepare(["talent.electric_shield", "talent.elemental_burst"], "electric"),
    );
    expect(electric.state.players[1]!.shield).toBe(6);
  });
  it("does not apply offensive element talents to attacks that explicitly ignore talent modifiers", () => {
    const state = hitState(),
      attack = state.combat.attack as Record<string, unknown>;
    state.players[0]!.initialTalentIds = [
      "talent.poison_shield",
      "talent.elemental_burst",
    ];
    state.players[1]!.initialTalentIds = [];
    state.players[1]!.shield = 10;
    attack.ignoreTalentModifiers = true;
    attack.damageSegments = [
      {
        segmentId: "poison",
        damageType: "normal",
        element: "poison",
        amount: 1,
        repeat: 2,
      },
    ];
    const result = resolveCurrentAttackTarget(state);
    expect(result.state.players[1]!.shield).toBe(8);
    expect(
      result.events.some((event) =>
        event.eventType.startsWith("attack.element"),
      ),
    ).toBe(false);
  });
  it("queues a copied ranged attack after Taoist makes it miss and enforces chain depth 10", () => {
    const prepare = (depth: number) => {
      const state = hitState(),
        attack = state.combat.attack as Record<string, unknown>;
      state.players[1]!.skillIds.push("skill.taoist.attack_reflection");
      attack.attackTypes = ["ranged"];
      attack.currentTargetHit = false;
      attack.currentTargetResult = "miss";
      attack.currentTargetMissReason = "dodge";
      attack.status = "targetMiss";
      attack.chainDepth = depth;
      return state;
    };
    const reflected = resolveCurrentAttackTarget(prepare(9));
    expect(reflected.state.combat.attack).toMatchObject({
      attackerSeat: 1,
      status: "committed",
      chainDepth: 10,
      targetRefs: ["character:1"],
      killCardRefs: [],
      attackTypes: ["ranged"],
      damageSegments: expect.any(Array),
      generatedByAttackId: expect.any(String),
      reflectedBySeat: 2,
    });
    expect(
      reflected.events.find((event) => event.eventType === "attack.queued")
        ?.payload,
    ).toMatchObject({ kind: "taoistReflection", chainDepth: 10 });
    const capped = resolveCurrentAttackTarget(prepare(10));
    expect(capped.state.combat.attack).toBeNull();
    expect(
      capped.events.some((event) => event.eventType === "attack.queued"),
    ).toBe(false);
    const melee = prepare(0),
      meleeAttack = melee.combat.attack as Record<string, unknown>;
    meleeAttack.attackTypes = ["melee"];
    expect(resolveCurrentAttackTarget(melee).state.combat.attack).toBeNull();
  });
  it("launches one Crystal Crab pincer only after an off-turn attack deals actual damage", () => {
    const prepare = (ironShield: number) => {
      const state = hitState(),
        boss = refFor(state, "boss.crystal_crab");
      relocate(state, boss, "boss:2");
      state.cards[boss]!.runtime.active = true;
      state.players[1]!.ironShield = ironShield;
      state.activeSeat = 1;
      return state;
    };
    const damaged = resolveCurrentAttackTarget(prepare(0));
    expect(damaged.state.combat.attack).toMatchObject({
      weaponId: "boss.crystal_crab.pincer",
      targetRefs: ["character:1"],
      status: "committed",
      customJudgments: expect.any(Array),
    });
    expect(
      damaged.state.players[1]!.markers[
        "crystalCrab.passivePincerLaunchedInWindow"
      ],
    ).toBe(1);
    let state = runCombatUntilBlocked(damaged.state, ruleset, () => 500).state;
    const window = state.pendingWindows[0]!,
      session = new AttackResponseSession(state);
    session.handle({
      commandId: "pincer-pass",
      gameId: state.gameId,
      expectedStateRevision: state.stateRevision,
      actorUserId: "u1",
      promptId: window.promptId,
      offerId: window.legalOfferIds.find((id) => id.includes(":pass:"))!,
    });
    state = runCombatUntilBlocked(session.state, ruleset, () => 500).state;
    state = finalizeJudgment(state, "white").state;
    const completed = runCombatUntilBlocked(state, ruleset, () => 500);
    expect(
      completed.state.players[0]!.statuses.some(
        (status) => status.statusId === "status.frozen",
      ),
    ).toBe(true);
    expect(completed.state.players[0]!.shield).toBe(3);
    const zero = resolveCurrentAttackTarget(prepare(2));
    expect(zero.state.combat.attack).toBeNull();
    expect(
      zero.state.players[1]!.markers[
        "crystalCrab.passivePincerLaunchedInWindow"
      ],
    ).toBeUndefined();
  });
  it("routes damage through Punching Bag's nonrecoverable extra-health layer before ordinary bars", () => {
    const prepare = (damageType: string, amount: number) => {
      const state = hitState(),
        target = state.players[1]!,
        attack = state.combat.attack as Record<string, unknown>;
      target.markers["punchingBag.extraHp"] = 12;
      target.shield = 10;
      target.hp = 10;
      attack.damageSegments = [
        { segmentId: "heavy", damageType, element: "none", amount, repeat: 1 },
      ];
      return state;
    };
    const normal = resolveCurrentAttackTarget(prepare("normal", 14));
    expect(normal.state.players[1]).toMatchObject({
      shield: 8,
      hp: 10,
      markers: { "punchingBag.extraHp": 0 },
    });
    expect(
      normal.events.find((event) => event.eventType === "attack.target.after")
        ?.payload,
    ).toMatchObject({
      actualDamage: 14,
      actualSpecialLayerLoss: 12,
      actualShieldLoss: 2,
    });
    const shieldOnly = resolveCurrentAttackTarget(prepare("shield", 5));
    expect(shieldOnly.state.players[1]).toMatchObject({
      shield: 5,
      markers: { "punchingBag.extraHp": 12 },
    });
  });
  it("clamps actual hp loss at the target's health floor while still entering dying at zero or below", () => {
    const state = hitState(),
      target = state.players[1]!,
      attack = state.combat.attack as Record<string, unknown>;
    target.shield = 0;
    target.hp = 1;
    target.markers.healthFloor = -1;
    attack.damageSegments = [
      {
        segmentId: "overkill",
        damageType: "hp",
        element: "none",
        amount: 20,
        repeat: 1,
      },
    ];
    const result = resolveCurrentAttackTarget(state);
    expect(result.state.players[1]).toMatchObject({
      hp: -1,
      lifeState: "dying",
    });
    expect(
      result.events.find((event) => event.eventType === "damage.finalized")
        ?.payload,
    ).toMatchObject({ finalDamage: 20, actualDamage: 2, actualHpLoss: 2 });
  });
  it("triggers life steal once from aggregate hp loss across multiple segments", () => {
    const state = hitState(),
      attacker = state.players[0]!,
      target = state.players[1]!,
      attack = state.combat.attack as Record<string, unknown>;
    attacker.initialTalentIds = ["talent.life_steal"];
    attacker.hp = Math.max(1, attacker.maxHp! - 2);
    target.shield = 0;
    target.hp = 10;
    attack.damageSegments = [
      {
        segmentId: "multi",
        damageType: "hp",
        element: "none",
        amount: 1,
        repeat: 2,
      },
    ];
    const result = resolveCurrentAttackTarget(state, ruleset);
    expect(result.state.players[0]!.hp).toBe(attacker.hp + 1);
    expect(
      result.events.filter((event) => event.eventType === "health.recovered"),
    ).toHaveLength(1);
    expect(
      result.events.filter((event) => event.eventType === "limit.consumed"),
    ).toHaveLength(1);
    expect(
      result.events.find((event) => event.eventType === "trigger.resolved")
        ?.payload,
    ).toMatchObject({ controllerSeat: 1 });
  });
  it("does not grant aggregate hp-loss benefits below threshold, through shields, or against a dead target without bars", () => {
    const prepare = () => {
      const state = hitState(),
        attacker = state.players[0]!;
      attacker.initialTalentIds = ["talent.life_steal"];
      attacker.hp = Math.max(1, attacker.maxHp! - 2);
      return state;
    };
    const below = prepare();
    below.players[1]!.shield = 0;
    below.players[1]!.hp = 10;
    (below.combat.attack as Record<string, unknown>).damageSegments = [
      {
        segmentId: "one",
        damageType: "hp",
        element: "none",
        amount: 1,
        repeat: 1,
      },
    ];
    expect(
      resolveCurrentAttackTarget(below, ruleset).events.some(
        (event) => event.eventType === "health.recovered",
      ),
    ).toBe(false);
    const shielded = prepare();
    shielded.players[1]!.shield = 10;
    (shielded.combat.attack as Record<string, unknown>).damageSegments = [
      {
        segmentId: "shield",
        damageType: "normal",
        element: "none",
        amount: 2,
        repeat: 1,
      },
    ];
    expect(
      resolveCurrentAttackTarget(shielded, ruleset).events.some(
        (event) => event.eventType === "health.recovered",
      ),
    ).toBe(false);
    const dead = prepare();
    dead.players[1]!.lifeState = "deadNotEliminated";
    dead.players[1]!.hp = null;
    dead.players[1]!.shield = null;
    (dead.combat.attack as Record<string, unknown>).damageSegments = [
      {
        segmentId: "dead",
        damageType: "hp",
        element: "none",
        amount: 20,
        repeat: 1,
      },
    ];
    expect(
      resolveCurrentAttackTarget(dead, ruleset).events.some(
        (event) => event.eventType === "health.recovered",
      ),
    ).toBe(false);
  });
  it("triggers mana siphon independently for each target in one multi-target attack", () => {
    const state = hitState(),
      attacker = state.players[0]!,
      attack = state.combat.attack as Record<string, unknown>;
    attacker.initialTalentIds = ["talent.mana_siphon"];
    const handBefore = state.zones["hand:1"]!.orderedCardRefs.length;
    for (const seat of [2, 3] as const) {
      state.players[seat - 1]!.shield = 0;
      state.players[seat - 1]!.hp = 10;
    }
    attack.targetRefs = ["character:2", "character:3"];
    attack.damageSegments = [
      {
        segmentId: "two",
        damageType: "hp",
        element: "none",
        amount: 2,
        repeat: 1,
      },
    ];
    state.combat.targetQueue = ["character:2", "character:3"];
    let result = resolveCurrentAttackTarget(state, ruleset),
      next = result.state;
    const nextAttack = next.combat.attack as Record<string, unknown>;
    nextAttack.currentTargetHit = true;
    nextAttack.currentTargetResult = "hit";
    nextAttack.status = "targetHit";
    result = resolveCurrentAttackTarget(next, ruleset);
    expect(result.state.zones["hand:1"]!.orderedCardRefs.length).toBe(
      handBefore + 2,
    );
    const allEvents = [...next.history.domainEvents, ...result.events];
    expect(
      allEvents.filter(
        (event) =>
          event.eventType === "limit.consumed" &&
          (event.payload as Record<string, unknown>).scope ===
            "perTargetPerAttack",
      ).length,
    ).toBeGreaterThanOrEqual(2);
  });
});
