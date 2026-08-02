import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { activateBossInTransaction, onBossOwnerTurnStart } from "./bossLifecycle.js";
import { CrystalCrabActivePincerSession } from "./crystalCrab.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";
import { EngineTransaction } from "./transaction.js";

let ruleset: LoadedRuleset;
const users = { 1: "u1", 2: "u2", 3: "u3", 4: "u4" } as const, characters = { 1: "character.knight", 2: "character.alchemist", 3: "character.ranger", 4: "character.wizard" } as const;
beforeAll(async () => { ruleset = await loadFrozenRuleset(resolve(import.meta.dirname, "../../../rulesets/v1.3.4")); });
function activeCrab() {
  let state = createInitialSetup(ruleset, { gameId: "crab", firstSeat: 1, seed: 173, usersBySeat: users, characterIdsBySeat: characters }); for (const seat of [1, 2, 3, 4] as const) state = resolveInitialRedraw(state, seat, false, ruleset).state; state.pendingWindows = [];
  const ref = Object.values(state.cards).find((card) => card.templateId === "boss.crystal_crab")!.cardRef, card = state.cards[ref]!, from = state.zones[card.zoneRef]!; from.orderedCardRefs.splice(from.orderedCardRefs.indexOf(ref), 1); state.zones["boss:1"]!.orderedCardRefs.push(ref); card.zoneRef = "boss:1"; card.ownerSeat = 1; card.controllerSeat = 1; card.faceUp = true;
  const tx = new EngineTransaction(state); activateBossInTransaction(tx, ruleset, ref, "test"); const committed = tx.commit(); committed.state.history.domainEvents.push(...committed.events); return { state: committed.state, ref };
}
function startOwner(state: AuthoritativeGameState, deadline = 900) { const tx = new EngineTransaction(state); onBossOwnerTurnStart(tx, ruleset, 1, deadline); const committed = tx.commit(); committed.state.history.domainEvents.push(...committed.events); return committed.state; }
describe("Crystal Crab active pincer", () => {
  it("opens when the previous off-turn window launched no passive pincer and can attack", () => {
    let { state, ref } = activeCrab(); state.players[0]!.hp = state.players[0]!.maxHp! - 1; state = startOwner(state);
    expect(state.pendingWindows[0]).toMatchObject({ kind: "crystalCrabActivePincer", deadlineAt: 900 }); expect(state.players[0]!.hp).toBe(state.players[0]!.maxHp);
    const window = state.pendingWindows[0]!, session = new CrystalCrabActivePincerSession(state, ruleset), result = session.handle({ commandId: "active-pincer", gameId: state.gameId, expectedStateRevision: state.stateRevision, actorUserId: "u1", promptId: window.promptId, offerId: window.legalOfferIds.find((id) => id.includes(":attack:"))!, targetRef: "character:3" });
    expect(result.accepted).toBe(true); expect(session.state.combat.attack).toMatchObject({ attackerSeat: 1, weaponRef: ref, weaponId: "boss.crystal_crab.pincer", modeId: "activePincer", targetRefs: ["character:3"], attackTypes: ["melee"], damageSegments: [{ amount: 1 }], customJudgments: expect.any(Array) });
  });
  it("suppresses the active chance after any launched passive pincer and resets the next window counter", () => {
    let { state } = activeCrab(); state.players[0]!.markers["crystalCrab.passivePincerLaunchedInWindow"] = 2; state = startOwner(state);
    expect(state.pendingWindows).toHaveLength(0); expect(state.players[0]!.markers["crystalCrab.passivePincerLaunchedInWindow"]).toBeUndefined(); state = startOwner(state, 901); expect(state.pendingWindows[0]?.kind).toBe("crystalCrabActivePincer");
  });
  it("passes on timeout without creating an attack", () => {
    let { state } = activeCrab(); state = startOwner(state); const session = new CrystalCrabActivePincerSession(state, ruleset); expect(session.handleTimeout("crab-timeout").accepted).toBe(true); expect(session.state.combat.attack).toBeNull();
  });
});
