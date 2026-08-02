import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { commitAttack } from "./attack.js";
import { resolveCurrentAttackTarget } from "./damage.js";
import { openAttackResponse, AttackResponseSession } from "./response.js";
import { setWeaponPreselection } from "./preselection.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";
import { processEventTriggers } from "./triggerBridge.js";
import { CriticalPenetrationSession } from "./triggerAttackFollowup.js";
import type { JsonValue } from "./types.js";
import { moveCard } from "./zones.js";

let ruleset: LoadedRuleset;
const users = { 1: "u1", 2: "u2", 3: "u3", 4: "u4" } as const,
  characters = {
    1: "character.ranger",
    2: "character.alchemist",
    3: "character.knight",
    4: "character.wizard",
  } as const;
beforeAll(async () => {
  ruleset = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});
function prepared() {
  let state = createInitialSetup(ruleset, {
    gameId: "critical-penetration",
    firstSeat: 1,
    seed: 127,
    usersBySeat: users,
    characterIdsBySeat: characters,
  });
  for (const seat of [1, 2, 3, 4] as const)
    state = resolveInitialRedraw(state, seat, false, ruleset).state;
  state.phase = "play";
  state.phaseMode = "manual";
  state.phaseBoundary = "body";
  state.phaseBodyResolved = false;
  state.players[0]!.limits.attackCountRemaining = 1;
  state.players[1]!.hp = 20;
  state.players[1]!.maxHp = 20;
  state.players[1]!.shield = 20;
  state.players[1]!.maxShield = 20;
  const weapon = Object.values(state.cards).find(
      (card) => card.templateId === "weapon.w09",
    )!,
    kills = Object.values(state.cards)
      .filter((card) => card.templateId.startsWith("basic.kill."))
      .slice(0, 2);
  state = moveCard(state, {
    cardRef: weapon.cardRef,
    toZoneRef: "weapon:1:1",
    moveKind: "equip",
  }).state;
  for (const kill of kills)
    state = moveCard(state, {
      cardRef: kill.cardRef,
      toZoneRef: "hand:1",
      moveKind: "gain",
    }).state;
  state = setWeaponPreselection(
    state,
    1,
    "weapon:1:1",
    "default",
    ruleset,
  ).state;
  state = commitAttack(state, ruleset, {
    attackerSeat: 1,
    targetRefs: ["character:2"],
    killCardRefs: [kills[0]!.cardRef],
  }).state;
  const attack = state.combat.attack as Record<string, JsonValue>;
  attack.critical = true;
  attack.currentTargetHit = true;
  attack.currentTargetResult = "hit";
  attack.status = "targetHit";
  return { state, weaponRef: weapon.cardRef, extraKillRef: kills[1]!.cardRef };
}
function opened() {
  const setup = prepared(),
    bridge = processEventTriggers(
      setup.state,
      ruleset,
      {
        eventType: "attack.hit",
        payload: { sourceSeat: 1, targetRef: "character:2" },
      },
      900,
      "critical-hit:1",
    );
  return { ...setup, bridge, window: bridge.state.pendingWindows[0]! };
}

describe("critical penetration trigger", () => {
  it("atomically pays one Kill and queues a same-weapon zero-count attack against another target", () => {
    const setup = opened();
    expect(setup.window).toMatchObject({
      kind: "criticalPenetration",
      prioritySeat: 1,
      mandatory: false,
      timeoutPolicy: "pass",
    });
    const targets = setup.window.context!.legalTargetRefs as string[];
    expect(targets).not.toContain("character:2");
    const targetRef = targets.find((ref) => ref === "character:3")!,
      session = new CriticalPenetrationSession(setup.bridge.state, ruleset),
      command = {
        commandId: "penetrate",
        gameId: setup.state.gameId,
        expectedStateRevision: setup.bridge.state.stateRevision,
        actorUserId: "u1",
        promptId: setup.window.promptId,
        offerId: "offer:critical-penetration:activate",
        killCardRef: setup.extraKillRef,
        targetRef,
      },
      result = session.handle(command);
    expect(result.accepted).toBe(true);
    expect(session.state.cards[setup.extraKillRef]!.zoneRef).toBe("resolving");
    expect(session.state.players[0]!.limits.attackCountRemaining).toBe(0);
    const parent = session.state.combat.attack as Record<string, JsonValue>,
      queued = (
        parent.afterAttackQueue as Array<Record<string, JsonValue>>
      )[0]!;
    expect(queued).toMatchObject({
      weaponRef: setup.weaponRef,
      modeId: "default",
      targetRefs: ["character:3"],
      killCardRefs: [setup.extraKillRef],
      attackCountCost: 0,
      status: "committed",
    });
    expect(queued.tags).toContain("criticalPenetrationFollowup");
    expect(queued.critical).toBeUndefined();
    expect(session.handle(command)).toEqual(result);
    const advanced = resolveCurrentAttackTarget(session.state);
    expect(advanced.state.combat.attack).toMatchObject({
      attackId: queued.attackId,
      targetRefs: ["character:3"],
      weaponRef: setup.weaponRef,
    });
    expect(advanced.events.map((event) => event.eventType)).toContain(
      "attack.queued.started",
    );
    const recursive = advanced.state.combat.attack as Record<string, JsonValue>;
    recursive.critical = true;
    expect(
      processEventTriggers(
        advanced.state,
        ruleset,
        {
          eventType: "attack.hit",
          payload: { sourceSeat: 1, targetRef: "character:3" },
        },
        950,
        "critical-hit:followup",
      ).state.pendingWindows,
    ).toHaveLength(0);
  });
  it("rejects stale targets without paying the Kill and times out as pass", () => {
    const setup = opened(),
      session = new CriticalPenetrationSession(setup.bridge.state, ruleset),
      before = structuredClone(session.state);
    expect(
      session.handle({
        commandId: "bad-target",
        gameId: setup.state.gameId,
        expectedStateRevision: setup.bridge.state.stateRevision,
        actorUserId: "u1",
        promptId: setup.window.promptId,
        offerId: "offer:critical-penetration:activate",
        killCardRef: setup.extraKillRef,
        targetRef: "character:2",
      }),
    ).toMatchObject({
      accepted: false,
      reasonCode: "CRITICAL_PENETRATION_TARGET_INVALID",
    });
    expect(session.state).toEqual(before);
    const timeout = new CriticalPenetrationSession(setup.bridge.state, ruleset);
    expect(timeout.handleTimeout("penetration-timeout").accepted).toBe(true);
    expect(timeout.state.cards[setup.extraKillRef]!.zoneRef).toBe("hand:1");
    expect(timeout.state.pendingWindows).toHaveLength(0);
  });
  it("keeps the extra Kill paid but queues no attack when Shield invalidates its color", () => {
    const setup = prepared(),
      shield = Object.values(setup.state.cards).find(
        (card) => card.templateId === "armor.a04",
      )!,
      blueKill = Object.values(setup.state.cards).find(
        (card) =>
          card.templateId === "basic.kill.blue" && card.zoneRef !== "resolving",
      )!;
    let state = moveCard(setup.state, {
      cardRef: shield.cardRef,
      toZoneRef: "armor:3",
      moveKind: "equip",
    }).state;
    state = moveCard(state, {
      cardRef: blueKill.cardRef,
      toZoneRef: "hand:1",
      moveKind: "gain",
    }).state;
    const bridge = processEventTriggers(
        state,
        ruleset,
        {
          eventType: "attack.hit",
          payload: { sourceSeat: 1, targetRef: "character:2" },
        },
        900,
        "critical-hit:shield",
      ),
      window = bridge.state.pendingWindows[0]!,
      session = new CriticalPenetrationSession(bridge.state, ruleset),
      result = session.handle({
        commandId: "penetrate-invalidated",
        gameId: state.gameId,
        expectedStateRevision: bridge.state.stateRevision,
        actorUserId: "u1",
        promptId: window.promptId,
        offerId: "offer:critical-penetration:activate",
        killCardRef: blueKill.cardRef,
        targetRef: "character:3",
      });
    expect(result.accepted).toBe(true);
    expect(session.state.cards[blueKill.cardRef]!.zoneRef).toBe("discardPile");
    expect(
      (session.state.combat.attack as Record<string, JsonValue>)
        .afterAttackQueue,
    ).toBeUndefined();
    expect(
      result.accepted && result.events.map((event) => event.eventType),
    ).toContain("attack.invalidated");
  });
  it("opens the real trigger window directly after a target passes its attack response", () => {
    const setup = prepared(),
      attack = setup.state.combat.attack as Record<string, JsonValue>;
    attack.status = "committed";
    delete attack.currentTargetHit;
    delete attack.currentTargetResult;
    const responding = openAttackResponse(setup.state, ruleset, 900).state,
      responseWindow = responding.pendingWindows[0]!,
      response = new AttackResponseSession(responding, ruleset),
      result = response.handle({
        commandId: "response-pass",
        gameId: setup.state.gameId,
        expectedStateRevision: responding.stateRevision,
        actorUserId: "u2",
        promptId: responseWindow.promptId,
        offerId: responseWindow.legalOfferIds.find((offer) =>
          offer.includes(":pass:"),
        )!,
      });
    expect(result.accepted).toBe(true);
    expect(response.state.pendingWindows[0]).toMatchObject({
      kind: "criticalPenetration",
      prioritySeat: 1,
    });
    expect(
      result.accepted && result.events.map((event) => event.eventType),
    ).toEqual(expect.arrayContaining(["attack.hit", "choice.requested"]));
  });
});
