import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { commitAttack } from "./attack.js";
import { resolveCurrentAttackTarget } from "./damage.js";
import { DarkKnightFinalStrikeSession } from "./darkKnightFinalStrike.js";
import { DyingCommandSession, ExtraGemDeathTransferSession, openDyingRescue } from "./dying.js";
import { setWeaponPreselection } from "./preselection.js";
import { AttackResponseSession, openAttackResponse } from "./response.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";
import { moveCard } from "./zones.js";
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
function dyingState() {
  let state = createInitialSetup(ruleset, {
    gameId: "dying",
    firstSeat: 1,
    seed: 31,
    usersBySeat: users,
    characterIdsBySeat: characters,
  });
  for (const seat of [1, 2, 3, 4] as const)
    state = resolveInitialRedraw(state, seat, false, ruleset).state;
  state.phase = "play";
  state.phaseMode = "manual";
  state.players[0]!.limits.attackCountRemaining = 1;
  state.players[1]!.shield = 0;
  state.players[1]!.hp = 1;
  const kill = refFor(state, "basic.kill.");
  relocate(state, kill, "hand:1");
  state = setWeaponPreselection(state, 1, "weapon:1:1", null, ruleset).state;
  state = commitAttack(state, ruleset, {
    attackerSeat: 1,
    targetRefs: ["character:2"],
    killCardRefs: [kill],
  }).state;
  state = openAttackResponse(state, ruleset, 500).state;
  const responseWindow = state.pendingWindows[0]!,
    response = new AttackResponseSession(state);
  response.handle({
    commandId: "hit",
    gameId: state.gameId,
    expectedStateRevision: state.stateRevision,
    actorUserId: "u2",
    promptId: responseWindow.promptId,
    offerId: responseWindow.legalOfferIds.find((id) => id.includes(":pass:"))!,
  });
  return resolveCurrentAttackTarget(response.state).state;
}
function passCurrent(session: DyingCommandSession, id: string) {
  const state = session.state,
    window = state.pendingWindows[0]!,
    player = state.players.find((item) => item.seat === window.prioritySeat)!;
  return session.handle({
    commandId: id,
    gameId: state.gameId,
    expectedStateRevision: state.stateRevision,
    actorUserId: player.userId,
    promptId: window.promptId,
    offerId: window.legalOfferIds.find((offer) => offer.includes(":pass:"))!,
  });
}
describe("dying rescue", () => {
  it("rescues with a potion then resumes and completes the outer attack", () => {
    let state = dyingState(),
      potion = refFor(state, "basic.potion.");
    relocate(state, potion, "hand:1");
    state = openDyingRescue(state, 700).state;
    const window = state.pendingWindows[0]!,
      session = new DyingCommandSession(state, () => 800),
      result = session.handle({
        commandId: "rescue",
        gameId: state.gameId,
        expectedStateRevision: state.stateRevision,
        actorUserId: "u1",
        promptId: window.promptId,
        offerId: window.legalOfferIds.find((id) => id.includes(":rescue:"))!,
        cardRef: potion,
      });
    expect(result.accepted).toBe(true);
    expect(session.state.players[1]).toMatchObject({
      lifeState: "alive",
      hp: 1,
    });
    expect(session.state.combat.dyingStack).toHaveLength(0);
    expect(session.state.combat.attack).toBeNull();
  });
  it("uses the configured strong-potion bonus for an equipped rescuer talent", () => {
    let state=dyingState(),potion=refFor(state,"basic.potion."),talent=refFor(state,"talent.strong_potion");
    relocate(state,potion,"hand:1");relocate(state,talent,"talent:1");
    state=openDyingRescue(state,700).state;const window=state.pendingWindows[0]!,session=new DyingCommandSession(state,()=>800,ruleset);
    expect(session.handle({commandId:"strong-rescue",gameId:state.gameId,expectedStateRevision:state.stateRevision,actorUserId:"u1",promptId:window.promptId,offerId:window.legalOfferIds.find(id=>id.includes(":rescue:"))!,cardRef:potion}).accepted).toBe(true);
    expect(session.state.players[1]).toMatchObject({lifeState:"alive",hp:2});
  });
  it("eliminates after every eligible player passes", () => {
    let state = openDyingRescue(dyingState(), 700).state,
      session = new DyingCommandSession(state, () => 800);
    for (let index = 0; index < 4; index++)
      expect(passCurrent(session, `pass:${index}`).accepted).toBe(true);
    expect(session.state.players[1]).toMatchObject({
      lifeState: "eliminated",
      hp: null,
      shield: null,
    });
    expect(session.state.combat.dyingStack).toHaveLength(0);
    expect(session.state.combat.attack).toBeNull();
  });
  it("declares victory when the eliminated character was the team's last member", () => {
    let state = dyingState();
    state.players[2]!.lifeState = "eliminated";
    state.players[2]!.hp = null;
    state.players[2]!.shield = null;
    state = openDyingRescue(state, 700).state;
    const session = new DyingCommandSession(state, () => 800);
    for (let index = 0; index < 3; index++)
      passCurrent(session, `victory-pass:${index}`);
    expect(session.state.lifecycle).toBe("ended");
    expect(session.state.winnerTeam).toBe("A");
  });
  it("replaces elimination with Iron Pirate death-without-elimination after rescue fails", () => {
    let state = dyingState(),
      boss = refFor(state, "boss.iron_pirate_king");
    relocate(state, boss, "boss:2");
    state = openDyingRescue(state, 700).state;
    const session = new DyingCommandSession(state, () => 800);
    for (let index = 0; index < 4; index++)
      passCurrent(session, `iron-pass:${index}`);
    expect(session.state.players[1]).toMatchObject({
      lifeState: "deadNotEliminated",
      hp: null,
      shield: null,
      markers: {
        nonLockedAbilitiesDisabled: true,
        ironPiratePostDeathOwnTurnCount: 0,
      },
    });
    expect(session.state.cards[boss]!.runtime.postDeathOwnTurnCount).toBe(0);
    expect(session.state.combat.dyingStack).toHaveLength(0);
    expect(session.state.combat.attack).toBeNull();
  });
  it("resolves Dark Grand Knight final strikes one at a time and timeout aborts the remainder", () => {
    let state = dyingState(),
      boss = refFor(state, "boss.dark_grand_knight");
    relocate(state, boss, "boss:2");
    state.cards[boss]!.runtime.active = true;
    state.players[1]!.markers["darkKnight.blackSword"] = 2;
    state = openDyingRescue(state, 700).state;
    const dying = new DyingCommandSession(state, () => 800);
    for (let index = 0; index < 4; index++) passCurrent(dying, `dark-pass:${index}`);
    expect(dying.state.players[1]).toMatchObject({ lifeState: "deadNotEliminated", hp: null, shield: null });
    expect(dying.state.pendingWindows[0]).toMatchObject({ kind: "darkKnightFinalStrike", prioritySeat: 2, timeoutPolicy: "abortRemaining" });
    const firstWindow = dying.state.pendingWindows[0]!,
      strikes = new DarkKnightFinalStrikeSession(dying.state);
    expect(strikes.handle({ commandId: "dark-strike-1", gameId: strikes.state.gameId, expectedStateRevision: strikes.state.stateRevision, actorUserId: "u2", promptId: firstWindow.promptId, offerId: firstWindow.legalOfferIds.find((id) => id.includes(":attack:"))!, targetRef: "character:1" }).accepted).toBe(true);
    expect(strikes.state.combat.attack).toMatchObject({ attackerSeat: 2, modeId: "finalStrike", range: "unlimited", attackTypes: ["melee"], ignoreArmor: true, cannotMeleeBlock: true, damageSegments: [{ amount: 3 }] });
    expect(strikes.state.players[1]!.markers["darkKnight.blackSword"]).toBe(1);
    state = openAttackResponse(strikes.state, ruleset, 900).state;
    const responseWindow = state.pendingWindows[0]!,
      response = new AttackResponseSession(state);
    response.handle({ commandId: "dark-target-pass", gameId: state.gameId, expectedStateRevision: state.stateRevision, actorUserId: "u1", promptId: responseWindow.promptId, offerId: responseWindow.legalOfferIds.find((id) => id.includes(":pass:"))! });
    state = resolveCurrentAttackTarget(response.state).state;
    expect(state.pendingWindows[0]).toMatchObject({ kind: "darkKnightFinalStrike", prioritySeat: 2 });
    const second = new DarkKnightFinalStrikeSession(state);
    expect(second.handleTimeout("dark-timeout").accepted).toBe(true);
    expect(second.state.players[1]!.lifeState).toBe("eliminated");
    expect(second.state.players[1]!.markers["darkKnight.blackSword"]).toBe(0);
    expect(second.state.combat.attack).toBeNull();
  });
  it("cancels an uncommitted final strike and eliminates when Dark Grand Knight is dismantled", () => {
    let state = dyingState(),
      boss = refFor(state, "boss.dark_grand_knight");
    relocate(state, boss, "boss:2");
    state.cards[boss]!.runtime.active = true;
    state.players[1]!.markers["darkKnight.blackSword"] = 1;
    state = openDyingRescue(state, 700).state;
    const dying = new DyingCommandSession(state, () => 800);
    for (let index = 0; index < 4; index++) passCurrent(dying, `dark-dismantle-pass:${index}`);
    const removed = moveCard(dying.state, { cardRef: boss, toZoneRef: "discardPile", moveKind: "dismantle" });
    expect(removed.state.players[1]!.lifeState).toBe("eliminated");
    expect(removed.state.players[1]!.markers["darkKnight.blackSword"]).toBe(0);
    expect(removed.state.pendingWindows.some((window) => window.kind === "darkKnightFinalStrike")).toBe(false);
  });
  it("lets a committed final strike finish before elimination when the boss is dismantled", () => {
    let state = dyingState(),
      boss = refFor(state, "boss.dark_grand_knight");
    relocate(state, boss, "boss:2");
    state.cards[boss]!.runtime.active = true;
    state.players[1]!.markers["darkKnight.blackSword"] = 1;
    state = openDyingRescue(state, 700).state;
    const dying = new DyingCommandSession(state, () => 800);
    for (let index = 0; index < 4; index++) passCurrent(dying, `dark-launched-pass:${index}`);
    const choice = dying.state.pendingWindows[0]!,
      strikes = new DarkKnightFinalStrikeSession(dying.state);
    strikes.handle({ commandId: "dark-launched", gameId: strikes.state.gameId, expectedStateRevision: strikes.state.stateRevision, actorUserId: "u2", promptId: choice.promptId, offerId: choice.legalOfferIds.find((id) => id.includes(":attack:"))!, targetRef: "character:1" });
    const removed = moveCard(strikes.state, { cardRef: boss, toZoneRef: "discardPile", moveKind: "dismantle" });
    expect(removed.state.players[1]!.lifeState).toBe("deadNotEliminated");
    expect(removed.state.combat.attack).toMatchObject({ modeId: "finalStrike", status: "committed" });
    state = openAttackResponse(removed.state, ruleset, 900).state;
    const responseWindow = state.pendingWindows[0]!,
      response = new AttackResponseSession(state);
    response.handle({ commandId: "dark-launched-target-pass", gameId: state.gameId, expectedStateRevision: state.stateRevision, actorUserId: "u1", promptId: responseWindow.promptId, offerId: responseWindow.legalOfferIds.find((id) => id.includes(":pass:"))! });
    state = resolveCurrentAttackTarget(response.state).state;
    expect(state.players[1]!.lifeState).toBe("eliminated");
    expect(state.combat.attack).toBeNull();
  });
  it("locks Extra Gem at dying entry, draws three, and removes it immediately after rescue", () => {
    let state=dyingState(),gem=refFor(state,"talent.extra_gem"),potion=refFor(state,"basic.potion.");relocate(state,gem,"talent:2");relocate(state,potion,"hand:1");const before=state.zones["hand:2"]!.orderedCardRefs.length;state=openDyingRescue(state,700,ruleset).state;expect(state.zones["hand:2"]!.orderedCardRefs).toHaveLength(before+3);expect(state.cards[gem]!.runtime.triggerLimitConsumed).toBe(true);expect(state.scheduledEffects.some(item=>item.executeAt==="thisDyingFlow.result:character:2")).toBe(true);const window=state.pendingWindows[0]!,session=new DyingCommandSession(state,()=>800);expect(session.handle({commandId:"gem-rescue",gameId:state.gameId,expectedStateRevision:state.stateRevision,actorUserId:"u1",promptId:window.promptId,offerId:window.legalOfferIds.find(id=>id.includes(":rescue:"))!,cardRef:potion}).accepted).toBe(true);expect(session.state.players[1]!.lifeState).toBe("alive");expect(session.state.cards[gem]!.zoneRef).toBe("outsideDeck");expect(session.state.scheduledEffects.some(item=>item.executeAt.includes("thisDyingFlow.result"))).toBe(false);
  });
  it("pauses elimination for Extra Gem, gives the entire hand, then removes it and resumes death", () => {
    let state=dyingState(),gem=refFor(state,"talent.extra_gem");relocate(state,gem,"talent:2");state=openDyingRescue(state,700,ruleset).state;const dying=new DyingCommandSession(state,()=>800);for(let index=0;index<4;index++)passCurrent(dying,`gem-death-pass:${index}`);expect(dying.state.pendingWindows[0]).toMatchObject({kind:"extraGemDeathTransfer",prioritySeat:2,mandatory:true,timeoutPolicy:"randomLegal"});expect(dying.state.players[1]!.lifeState).toBe("dying");const cards=[...dying.state.zones["hand:2"]!.orderedCardRefs],window=dying.state.pendingWindows[0]!,transfer=new ExtraGemDeathTransferSession(dying.state,()=>900);expect(transfer.handle({commandId:"gem-give",gameId:dying.state.gameId,expectedStateRevision:dying.state.stateRevision,actorUserId:"u2",promptId:window.promptId,offerId:"offer:extra-gem-death:character:1",targetRef:"character:1"}).accepted).toBe(true);expect(transfer.state.players[1]!.lifeState).toBe("eliminated");expect(transfer.state.zones["hand:2"]!.orderedCardRefs).toHaveLength(0);expect(transfer.state.zones["hand:1"]!.orderedCardRefs).toEqual(expect.arrayContaining(cards));expect(transfer.state.cards[gem]!.zoneRef).toBe("outsideDeck");
  });
  it("uses reproducible random legal targeting when Extra Gem death transfer times out", () => {
    let state=dyingState(),gem=refFor(state,"talent.extra_gem");relocate(state,gem,"talent:2");state=openDyingRescue(state,700,ruleset).state;const dying=new DyingCommandSession(state,()=>800);for(let index=0;index<4;index++)passCurrent(dying,`gem-timeout-pass:${index}`);const transfer=new ExtraGemDeathTransferSession(dying.state,()=>900),result=transfer.handleTimeout("gem-timeout");expect(result.accepted).toBe(true);expect(transfer.state.randomHistory.at(-1)).toMatchObject({purpose:"extraGemDeathTransfer.timeout",candidateRefs:expect.any(Array),resultRefs:[expect.any(String)]});expect(transfer.state.players[1]!.lifeState).toBe("eliminated");
  });
  it("does not consume an equipped Extra Gem while ordinary equipment effects are disabled", () => {
    let state=dyingState(),gem=refFor(state,"talent.extra_gem");relocate(state,gem,"talent:2");state.players[1]!.markers.equipmentEffectsDisabled=true;const before=state.zones["hand:2"]!.orderedCardRefs.length;state=openDyingRescue(state,700,ruleset).state;expect(state.zones["hand:2"]!.orderedCardRefs).toHaveLength(before);expect(state.cards[gem]!.runtime.triggerLimitConsumed).toBeUndefined();expect(state.scheduledEffects).toHaveLength(0);
  });
});
