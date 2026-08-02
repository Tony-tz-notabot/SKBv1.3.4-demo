import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { commitAttack } from "./attack.js";
import { runCombatUntilBlocked } from "./combatScheduler.js";
import { finalizeJudgment } from "./judgment.js";
import { setWeaponPreselection } from "./preselection.js";
import { AttackResponseSession } from "./response.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";

let ruleset: LoadedRuleset;
beforeAll(async () => { ruleset = await loadFrozenRuleset(resolve(import.meta.dirname, "../../../rulesets/v1.3.4")); });

function relocate(state: AuthoritativeGameState, cardRef: string, zoneRef: string): void {
  const card = state.cards[cardRef]!;
  state.zones[card.zoneRef]!.orderedCardRefs.splice(state.zones[card.zoneRef]!.orderedCardRefs.indexOf(cardRef), 1);
  state.zones[zoneRef]!.orderedCardRefs.push(cardRef);
  Object.assign(card, { zoneRef, ownerSeat: state.zones[zoneRef]!.ownerSeat, controllerSeat: state.zones[zoneRef]!.ownerSeat, faceUp: true });
}

function respondedHit(weaponId: string): AuthoritativeGameState {
  let state = createInitialSetup(ruleset, {
    gameId: `weapon-timing-${weaponId}`, firstSeat: 1, seed: 515,
    usersBySeat: { 1: "u1", 2: "u2", 3: "u3", 4: "u4" },
    characterIdsBySeat: { 1: "character.knight", 2: "character.wizard", 3: "character.ranger", 4: "character.alchemist" },
  });
  for (const seat of [1, 2, 3, 4] as const) state = resolveInitialRedraw(state, seat, false, ruleset).state;
  Object.assign(state, { phase: "play", phaseBoundary: "body", phaseMode: "manual", activeSeat: 1 });
  state.players[0]!.limits.attackCountRemaining = 1;
  state.players[1]!.shield = 20;
  state.players[1]!.maxShield = 20;
  const weapon = Object.values(state.cards).find((card) => card.templateId === weaponId)!.cardRef;
  const kill = Object.values(state.cards).find((card) => card.templateId.startsWith("basic.kill."))!.cardRef;
  relocate(state, weapon, "weapon:1:1");
  relocate(state, kill, "hand:1");
  state = setWeaponPreselection(state, 1, "weapon:1:1", null, ruleset).state;
  state = commitAttack(state, ruleset, { attackerSeat: 1, targetRefs: ["character:2"], killCardRefs: [kill] }).state;
  let run = runCombatUntilBlocked(state, ruleset, () => 900);
  const window = run.state.pendingWindows[0]!;
  const response = new AttackResponseSession(run.state);
  response.handle({ commandId: "pass", gameId: state.gameId, expectedStateRevision: run.state.stateRevision, actorUserId: "u2", promptId: window.promptId, offerId: window.legalOfferIds.find((id) => id.includes(":pass:"))! });
  return response.state;
}

describe("weapon judgment damage timing", () => {
  it("runs W52 once after every base occurrence and inserts matched poison afterward", () => {
    let run = runCombatUntilBlocked(respondedHit("weapon.w52"), ruleset, () => 900);
    expect(run.stoppedReason).toBe("judgment");
    expect(run.events.filter((event) => event.eventType === "damage.applied")).toHaveLength(3);
    expect(run.state.resolutionStack[0]!.context).toMatchObject({ judgmentRuleId: "after_all_base_segments", occurrenceKey: "afterBase" });
    const judged = finalizeJudgment(run.state, "green").state;
    expect((judged.combat.attack as Record<string, unknown>).pendingJudgmentEffects).toHaveLength(1);
    run = runCombatUntilBlocked(judged, ruleset, () => 900);
    expect(run.stoppedReason).toBe("combatComplete");
    expect(run.events.filter((event) => event.eventType === "damage.applied" && (event.payload as { element?: string }).element === "poison")).toHaveLength(2);
  });

  it("runs W55 independently after each base occurrence", () => {
    let run = runCombatUntilBlocked(respondedHit("weapon.w55"), ruleset, () => 900);
    expect(run.stoppedReason).toBe("judgment");
    expect(run.events.filter((event) => event.eventType === "damage.applied")).toHaveLength(1);
    const firstKey = String(run.state.resolutionStack[0]!.context.occurrenceKey);
    run = runCombatUntilBlocked(finalizeJudgment(run.state, "green").state, ruleset, () => 900);
    expect(run.stoppedReason).toBe("judgment");
    expect(String(run.state.resolutionStack[0]!.context.occurrenceKey)).not.toBe(firstKey);
    run = runCombatUntilBlocked(finalizeJudgment(run.state, "red").state, ruleset, () => 900);
    expect(run.stoppedReason).toBe("combatComplete");
  });
});
