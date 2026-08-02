import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { activateBossInTransaction, onBossOwnerTurnStart } from "./bossLifecycle.js";
import { applyDirectDamageInTransaction } from "./damage.js";
import { RedLordHammerSession } from "./redLordHammer.js";
import { runCombatUntilBlocked } from "./combatScheduler.js";
import { AttackResponseSession } from "./response.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";
import { EngineTransaction } from "./transaction.js";

let ruleset: LoadedRuleset;
const users = { 1: "u1", 2: "u2", 3: "u3", 4: "u4" } as const,
  characters = { 1: "character.knight", 2: "character.alchemist", 3: "character.ranger", 4: "character.wizard" } as const;
beforeAll(async () => { ruleset = await loadFrozenRuleset(resolve(import.meta.dirname, "../../../rulesets/v1.3.4")); });
function activeRed() {
  let state = createInitialSetup(ruleset, { gameId: "red", firstSeat: 1, seed: 167, usersBySeat: users, characterIdsBySeat: characters });
  for (const seat of [1, 2, 3, 4] as const) state = resolveInitialRedraw(state, seat, false, ruleset).state;
  state.pendingWindows = [];
  const ref = Object.values(state.cards).find((card) => card.templateId === "boss.red_lord")!.cardRef, card = state.cards[ref]!, from = state.zones[card.zoneRef]!;
  from.orderedCardRefs.splice(from.orderedCardRefs.indexOf(ref), 1); state.zones["boss:1"]!.orderedCardRefs.push(ref); card.zoneRef = "boss:1"; card.ownerSeat = 1; card.controllerSeat = 1; card.faceUp = true;
  const tx = new EngineTransaction(state); activateBossInTransaction(tx, ruleset, ref, "test"); const committed = tx.commit(); committed.state.history.domainEvents.push(...committed.events); return { state: committed.state, ref };
}
function damage(state: AuthoritativeGameState, amount: number) {
  const tx = new EngineTransaction(state), result = applyDirectDamageInTransaction(tx, { damageId: `red:${state.stateRevision}`, sourceSeat: 2, targetRef: "character:1", amount, damageType: "normal", element: "none", isAdditional: false, ruleset });
  return { state: tx.commit().state, result };
}
function commitWithHistory(tx: EngineTransaction<AuthoritativeGameState>) { const committed = tx.commit(); committed.state.history.domainEvents.push(...committed.events); return committed.state; }
describe("Red Lord damage replacement", () => {
  it("replaces only a positive post-iron result with one and ignores zero", () => {
    let { state, ref } = activeRed(); state.players[0]!.shield = 10;
    let applied = damage(state, 1); state = applied.state; expect(applied.result.actualDamage).toBe(0); expect(state.cards[ref]!.runtime["redLord.actualPositiveDamageCount"]).toBe(0);
    applied = damage(state, 5); expect(applied.result.finalDamage).toBe(1); expect(applied.result.actualDamage).toBe(1); expect(applied.state.cards[ref]!.runtime["redLord.actualPositiveDamageCount"]).toBe(1);
  });
  it("leaves immediately after the fourth actual deduction, then applies frozen and electrified", () => {
    let { state, ref } = activeRed(); state.players[0]!.shield = 10;
    for (let index = 0; index < 4; index++) state = damage(state, 3).state;
    expect(state.cards[ref]!.zoneRef).toBe("discardPile"); expect(state.players[0]!.ironShield).toBe(0); expect(state.players[0]!.statuses.map((status) => status.statusId)).toEqual(expect.arrayContaining(["status.frozen", "status.electrified"]));
  });
});

describe("Red Lord Sealing Hammer", () => {
  it("opens on each of the first two original prepare timings and times out by passing", () => {
    let { state, ref } = activeRed();
    let tx = new EngineTransaction(state); onBossOwnerTurnStart(tx, ruleset, 1, 900); state = commitWithHistory(tx);
    expect(state.pendingWindows[0]).toMatchObject({ kind: "redLordSealingHammer", deadlineAt: 900 });
    let session = new RedLordHammerSession(state, ruleset); expect(session.handleTimeout("hammer-timeout-1").accepted).toBe(true); state = session.state;
    tx = new EngineTransaction(state); onBossOwnerTurnStart(tx, ruleset, 1, 901); state = commitWithHistory(tx);
    expect(state.cards[ref]!.runtime.ownerTurnOrdinal).toBe(2); expect(state.pendingWindows[0]?.kind).toBe("redLordSealingHammer");
    session = new RedLordHammerSession(state, ruleset); session.handleTimeout("hammer-timeout-2"); state = session.state;
    tx = new EngineTransaction(state); onBossOwnerTurnStart(tx, ruleset, 1, 902); expect(tx.draft.pendingWindows).toHaveLength(0);
  });
  it("creates one composite attack whose two targets use independent melee and laser profiles", () => {
    let { state } = activeRed(); const tx = new EngineTransaction(state); onBossOwnerTurnStart(tx, ruleset, 1, 900); state = commitWithHistory(tx);
    const window = state.pendingWindows[0]!, session = new RedLordHammerSession(state, ruleset), handled = session.handle({ commandId: "hammer", gameId: state.gameId, expectedStateRevision: state.stateRevision, actorUserId: "u1", promptId: window.promptId, offerId: window.legalOfferIds.find((id) => id.includes(":activate:"))!, meleeTargetRef: "character:2", laserTargetRef: "character:3" });
    expect(handled.accepted).toBe(true); state = session.state;
    expect(state.combat.attack).toMatchObject({ targetRefs: ["character:2", "character:3"], attackTypes: ["melee"], damageSegments: [{ segmentId: "sealingHammerMelee", amount: 3 }] });
    let combat = runCombatUntilBlocked(state, ruleset, () => 900); expect(combat.stoppedReason).toBe("responseWindow");
    let response = new AttackResponseSession(combat.state, ruleset), responseWindow = combat.state.pendingWindows[0]!; response.handle({ commandId: "hammer-pass-melee", gameId: state.gameId, expectedStateRevision: combat.state.stateRevision, actorUserId: "u2", promptId: responseWindow.promptId, offerId: responseWindow.legalOfferIds.find((id) => id.includes(":pass:"))! });
    combat = runCombatUntilBlocked(response.state, ruleset, () => 900); expect(combat.stoppedReason).toBe("responseWindow");
    expect(combat.state.combat.currentTargetRef).toBe("character:3"); expect(combat.state.combat.attack).toMatchObject({ attackTypes: ["laser"], cannotMeleeBlock: true, damageSegments: [{ segmentId: "sealingHammerLaser", amount: 3 }] });
    expect(combat.state.pendingWindows[0]!.legalOfferIds.some((id) => id.includes("meleeBlock"))).toBe(false);
  });
  it("allows either target group to be empty but rejects selecting the same target twice", () => {
    let { state } = activeRed(); const tx = new EngineTransaction(state); onBossOwnerTurnStart(tx, ruleset, 1, 900); state = commitWithHistory(tx); const window = state.pendingWindows[0]!, session = new RedLordHammerSession(state, ruleset);
    const rejected = session.handle({ commandId: "same", gameId: state.gameId, expectedStateRevision: state.stateRevision, actorUserId: "u1", promptId: window.promptId, offerId: window.legalOfferIds.find((id) => id.includes(":activate:"))!, meleeTargetRef: "character:2", laserTargetRef: "character:2" }); expect(rejected).toMatchObject({ accepted: false, reasonCode: "TARGETS_NOT_DISTINCT" });
    const accepted = session.handle({ commandId: "laser-only", gameId: state.gameId, expectedStateRevision: state.stateRevision, actorUserId: "u1", promptId: window.promptId, offerId: window.legalOfferIds.find((id) => id.includes(":activate:"))!, laserTargetRef: "character:4" }); expect(accepted.accepted).toBe(true); expect(session.state.combat.attack).toMatchObject({ targetRefs: ["character:4"], attackTypes: ["laser"] });
  });
});
