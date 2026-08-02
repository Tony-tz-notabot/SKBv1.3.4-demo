import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { runCombatUntilBlocked } from "./combatScheduler.js";
import { finalizeJudgment } from "./judgment.js";
import { PurpleLordHeroBladeSession } from "./purpleLord.js";
import { AttackResponseSession } from "./response.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";
import { applyStatus } from "./status.js";
import { advanceTimeline } from "./timeline.js";
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
function started() {
  let state = createInitialSetup(ruleset, {
    gameId: "purple",
    firstSeat: 1,
    seed: 163,
    usersBySeat: users,
    characterIdsBySeat: characters,
  });
  for (const seat of [1, 2, 3, 4] as const)
    state = resolveInitialRedraw(state, seat, false, ruleset).state;
  state.pendingWindows = [];
  return state;
}
function purple(state: AuthoritativeGameState) {
  const ref = Object.values(state.cards).find(
      (card) => card.templateId === "boss.purple_lord",
    )!.cardRef,
    card = state.cards[ref]!,
    from = state.zones[card.zoneRef]!;
  from.orderedCardRefs.splice(from.orderedCardRefs.indexOf(ref), 1);
  state.zones["boss:1"]!.orderedCardRefs.push(ref);
  card.zoneRef = "boss:1";
  card.ownerSeat = 1;
  card.controllerSeat = 1;
  card.faceUp = true;
  card.runtime.active = true;
  card.runtime.activationStatus = "active";
  card.runtime.ownerTurnOrdinal = 0;
  card.runtime.usedAtRound = 1;
  card.runtime.usedAtActiveSeat = 1;
  return ref;
}
function passResponse(state: AuthoritativeGameState, id: string) {
  const window = state.pendingWindows[0]!,
    session = new AttackResponseSession(state, ruleset);
  session.handle({
    commandId: id,
    gameId: state.gameId,
    expectedStateRevision: state.stateRevision,
    actorUserId: `u${window.prioritySeat}`,
    promptId: window.promptId,
    offerId: window.legalOfferIds.find((offer) => offer.includes(":pass:"))!,
  });
  return session.state;
}
describe("Purple Lord scripted attacks", () => {
  it("commits Demon Blade before another character's prepare phase and judges on a zero-damage hit", () => {
    let state = started(),
      ref = purple(state);
    state.activeSeat = 1;
    state.phase = "end";
    state.phaseBoundary = "body";
    state.phaseMode = "automatic";
    state.phaseBodyResolved = true;
    state.players[1]!.ironShield = 2;
    state = advanceTimeline(state, { kind: "normal" }, ruleset, 700).state;
    expect(state.activeSeat).toBe(2);
    expect(state.combat.attack).toMatchObject({
      attackerSeat: 1,
      weaponRef: ref,
      weaponId: "boss.purple_lord.demonBlade",
      targetRefs: ["character:2"],
      damageSegments: [{ amount: 2 }],
    });
    expect(
      state.history.domainEvents.find(
        (event) => event.eventType === "phase.before",
      )!.eventSeq,
    ).toBeLessThan(
      state.history.domainEvents.find(
        (event) =>
          event.eventType === "attack.commit" &&
          (event.payload as Record<string, unknown>).scripted === true,
      )!.eventSeq,
    );
    let combat = runCombatUntilBlocked(state, ruleset, () => 700);
    expect(combat.stoppedReason).toBe("responseWindow");
    state = passResponse(combat.state, "demon-pass");
    combat = runCombatUntilBlocked(state, ruleset, () => 700);
    expect(combat.stoppedReason).toBe("judgment");
    state = finalizeJudgment(combat.state, "white").state;
    combat = runCombatUntilBlocked(state, ruleset, () => 700);
    expect(combat.stoppedReason).toBe("combatComplete");
    expect(
      combat.state.players[1]!.statuses.some(
        (status) => status.statusId === "status.frozen",
      ),
    ).toBe(true);
    expect(combat.state.players[1]!.hp).toBe(combat.state.players[1]!.maxHp);
  });
  it("opens Hero Blade once at the original prepare timing and commits a range-four attack", () => {
    let state = started(),
      ref = purple(state);
    state = applyStatus(state, ruleset, {
      ownerSeat: 1,
      statusId: "status.stasis",
      sourceRef: ref,
    }).state;
    state.activeSeat = 4;
    state.phase = "end";
    state.phaseBoundary = "body";
    state.phaseMode = "automatic";
    state.phaseBodyResolved = true;
    state = advanceTimeline(state, { kind: "normal" }, ruleset, 900).state;
    expect(state.activeSeat).toBe(1);
    expect(state.phase).toBe("prepare");
    expect(state.phaseBoundary).toBe("after");
    expect(state.pendingWindows[0]).toMatchObject({
      kind: "purpleLordHeroBlade",
      prioritySeat: 1,
      deadlineAt: 900,
      timeoutPolicy: "pass",
    });
    expect(state.cards[ref]!.runtime.heroBladeWindowResolved).toBe(true);
    const window = state.pendingWindows[0]!,
      session = new PurpleLordHeroBladeSession(state, ruleset),
      result = session.handle({
        commandId: "hero",
        gameId: state.gameId,
        expectedStateRevision: state.stateRevision,
        actorUserId: "u1",
        promptId: window.promptId,
        offerId: window.legalOfferIds.find((id) => id.includes(":attack:"))!,
        targetRef: "character:3",
      });
    expect(result.accepted).toBe(true);
    expect(session.state.combat.attack).toMatchObject({
      attackerSeat: 1,
      weaponId: "boss.purple_lord.heroBlade",
      range: 4,
      targetRefs: ["character:3"],
      damageSegments: [{ amount: 4 }],
    });
    expect(session.state.cards[ref]!.runtime.heroBladeWindowResolved).toBe(
      true,
    );
  });
  it("passes Hero Blade on timeout without creating an attack or later makeup window", () => {
    let state = started(),
      ref = purple(state);
    state.activeSeat = 4;
    state.phase = "end";
    state.phaseBoundary = "body";
    state.phaseMode = "automatic";
    state.phaseBodyResolved = true;
    state = advanceTimeline(state, { kind: "normal" }, ruleset, 900).state;
    const session = new PurpleLordHeroBladeSession(state, ruleset);
    expect(session.handleTimeout("hero-timeout").accepted).toBe(true);
    expect(session.state.combat.attack).toBeNull();
    expect(
      session.state.pendingWindows.some(
        (window) => window.kind === "purpleLordHeroBlade",
      ),
    ).toBe(false);
    expect(session.state.cards[ref]!.runtime.heroBladeWindowResolved).toBe(
      true,
    );
  });
});
