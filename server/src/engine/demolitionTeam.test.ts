import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import {
  buildDemolitionTeamOffers,
  DemolitionTeamSession,
} from "./demolitionTeam.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState, Seat } from "./state.js";

let ruleset: LoadedRuleset;
beforeAll(async () => {
  ruleset = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});

function relocate(
  state: AuthoritativeGameState,
  ref: string,
  toZoneRef: string,
) {
  const card = state.cards[ref]!,
    source = state.zones[card.zoneRef]!,
    target = state.zones[toZoneRef]!;
  source.orderedCardRefs.splice(source.orderedCardRefs.indexOf(ref), 1);
  target.orderedCardRefs.push(ref);
  Object.assign(card, {
    zoneRef: toZoneRef,
    ownerSeat: target.ownerSeat,
    controllerSeat: target.ownerSeat,
    faceUp: true,
  });
}

function ready() {
  let state = createInitialSetup(ruleset, {
    gameId: "demolition-team",
    firstSeat: 1,
    seed: 806,
    usersBySeat: { 1: "u1", 2: "u2", 3: "u3", 4: "u4" },
    characterIdsBySeat: {
      1: "character.knight",
      2: "character.alchemist",
      3: "character.ranger",
      4: "character.wizard",
    },
  });
  for (const seat of [1, 2, 3, 4] as const)
    state = resolveInitialRedraw(state, seat, false, ruleset).state;
  const card = Object.values(state.cards).find(
    (item) => item.templateId === "special.sp08",
  )!;
  relocate(state, card.cardRef, "hand:1");
  state.activeSeat = 1;
  state.phase = "play";
  state.phaseBoundary = "body";
  state.phaseMode = "manual";
  state.phaseBodyResolved = false;
  state.pendingWindows = [
    {
      promptId: "play:demolition",
      kind: "playPhaseAction",
      prioritySeat: 1,
      mandatory: false,
      deadlineAt: 900,
      timeoutPolicy: "pass",
      legalOfferIds: ["offer:playPhaseAction:finish"],
      context: {},
    },
  ];
  return { state, cardRef: card.cardRef };
}

function weapons(state: AuthoritativeGameState, count: number) {
  return Object.values(state.cards)
    .filter((card) => card.templateId.startsWith("weapon."))
    .slice(0, count)
    .map((card) => card.cardRef);
}

function start(session: DemolitionTeamSession, cardRef: string) {
  return session.handleUse({
    commandId: "demolition-use",
    gameId: session.state.gameId,
    expectedStateRevision: session.state.stateRevision,
    actorUserId: "u1",
    promptId: "play:demolition",
    offerId: `offer:special.sp08:${cardRef}`,
    cardRef,
  });
}

function pass(session: DemolitionTeamSession, id: string) {
  const window = session.state.pendingWindows[0]!,
    actor = session.state.players.find(
      (player) => player.seat === window.prioritySeat,
    )!;
  return session.handleChoice({
    commandId: id,
    gameId: session.state.gameId,
    expectedStateRevision: session.state.stateRevision,
    actorUserId: actor.userId,
    promptId: window.promptId,
    offerId: "offer:demolition-discard:pass",
    selectedWeaponRefs: [],
  });
}

describe("Demolition Team", () => {
  it("offers one optional discard to each participant, then transfers a simultaneous weapon snapshot", () => {
    const prepared = ready(),
      refs = weapons(prepared.state, 6);
    prepared.state.players[0]!.initialTalentIds.push("talent.triple_wield");
    relocate(prepared.state, refs[0]!, "weapon:1:1");
    relocate(prepared.state, refs[1]!, "weapon:2:1");
    relocate(prepared.state, refs[2]!, "weapon:3:1");
    relocate(prepared.state, refs[3]!, "thirdWeapon:1");
    relocate(prepared.state, refs[4]!, "weapon:1:2");
    relocate(prepared.state, refs[5]!, "thirdWeapon:2");
    const session = new DemolitionTeamSession(prepared.state, ruleset);
    expect(buildDemolitionTeamOffers(prepared.state, ruleset, 1)).toHaveLength(
      1,
    );
    expect(start(session, prepared.cardRef).accepted).toBe(true);
    for (let index = 0; index < 4; index += 1) {
      expect(session.state.pendingWindows[0]).toMatchObject({
        kind: "demolitionOptionalDiscard",
        prioritySeat: (index + 1) as Seat,
      });
      pass(session, `pass:${index}`);
    }
    expect(session.state.pendingWindows[0]).toMatchObject({
      kind: "demolitionWeaponOverflow",
      prioritySeat: 2,
      mandatory: true,
      context: { requiredCount: 1, regularRequiredCount: 1 },
    });
    expect(session.state.zones["weapon:1:2"]!.orderedCardRefs).toEqual(
      expect.arrayContaining(refs.slice(0, 3)),
    );
    expect(session.state.cards[refs[3]!]!.zoneRef).toBe("thirdWeapon:2");
    expect(session.state.cards[refs[4]!]!.zoneRef).toBe("weapon:1:3");
    expect(session.state.cards[refs[5]!]!.zoneRef).toBe("thirdWeapon:3");
    expect(
      session.state.history.domainEvents.some(
        (event) => event.eventType === "snapshot.saved",
      ),
    ).toBe(true);
  });

  it("resolves overflow by exact class, compacts slots, and restores the original user's play window", () => {
    const prepared = ready(),
      refs = weapons(prepared.state, 3);
    prepared.state.players[0]!.initialTalentIds.push("talent.triple_wield");
    refs.forEach((ref, index) =>
      relocate(prepared.state, ref, `weapon:${index + 1}:1`),
    );
    const session = new DemolitionTeamSession(prepared.state, ruleset);
    start(session, prepared.cardRef);
    for (let index = 0; index < 4; index += 1)
      pass(session, `all-pass:${index}`);
    const window = session.state.pendingWindows[0]!,
      chosen = refs[1]!,
      command = {
        commandId: "overflow-choice",
        gameId: session.state.gameId,
        expectedStateRevision: session.state.stateRevision,
        actorUserId: "u2",
        promptId: window.promptId,
        offerId: "offer:demolition-overflow:submit",
        selectedWeaponRefs: [chosen],
      },
      result = session.handleChoice(command);
    expect(result.accepted).toBe(true);
    expect(session.handleChoice(command)).toEqual(result);
    expect(session.state.cards[chosen]!.zoneRef).toBe("discardPile");
    expect(session.state.zones["weapon:1:2"]!.orderedCardRefs).toHaveLength(1);
    expect(session.state.zones["weapon:2:2"]!.orderedCardRefs).toHaveLength(1);
    expect(session.state.zones["weapon:3:2"]!.orderedCardRefs).toHaveLength(0);
    expect(session.state.cards[prepared.cardRef]!.zoneRef).toBe("discardPile");
    expect(session.state.pendingWindows[0]).toMatchObject({
      kind: "playPhaseAction",
      prioritySeat: 1,
    });
  });

  it("allows a real first-stage discard, while timeout chooses pass", () => {
    const prepared = ready(),
      [first, second] = weapons(prepared.state, 2);
    relocate(prepared.state, first!, "weapon:1:1");
    relocate(prepared.state, second!, "thirdWeapon:1");
    const session = new DemolitionTeamSession(prepared.state, ruleset);
    start(session, prepared.cardRef);
    const window = session.state.pendingWindows[0]!,
      result = session.handleChoice({
        commandId: "discard-third",
        gameId: session.state.gameId,
        expectedStateRevision: session.state.stateRevision,
        actorUserId: "u1",
        promptId: window.promptId,
        offerId: `offer:demolition-discard:${second}`,
        selectedWeaponRefs: [second!],
      });
    expect(result.accepted).toBe(true);
    expect(session.state.cards[second!]!.zoneRef).toBe("discardPile");
    expect(session.state.pendingWindows[0]!.prioritySeat).toBe(2);
    expect(session.handleTimeout("optional-timeout").accepted).toBe(true);
    expect(session.state.cards[first!]!.zoneRef).toBe("weapon:1:1");
  });

  it("skips eliminated participants and sends their predecessor's snapshot to the next participant", () => {
    const prepared = ready(),
      [weapon] = weapons(prepared.state, 1);
    relocate(prepared.state, weapon!, "weapon:1:1");
    prepared.state.players[1]!.lifeState = "eliminated";
    prepared.state.players[1]!.hp = null;
    prepared.state.players[1]!.shield = null;
    const session = new DemolitionTeamSession(prepared.state, ruleset);
    start(session, prepared.cardRef);
    expect(session.state.pendingWindows[0]!.prioritySeat).toBe(1);
    pass(session, "skip-pass-1");
    expect(session.state.pendingWindows[0]!.prioritySeat).toBe(3);
    pass(session, "skip-pass-3");
    pass(session, "skip-pass-4");
    expect(session.state.cards[weapon!]!.zoneRef).toBe("weapon:1:3");
    expect(session.state.pendingWindows[0]).toMatchObject({
      kind: "playPhaseAction",
    });
  });

  it("uses reproducible random overflow selection on timeout", () => {
    const prepared = ready(),
      refs = weapons(prepared.state, 3);
    prepared.state.players[0]!.initialTalentIds.push("talent.triple_wield");
    refs.forEach((ref, index) =>
      relocate(prepared.state, ref, `weapon:${index + 1}:1`),
    );
    const session = new DemolitionTeamSession(prepared.state, ruleset);
    start(session, prepared.cardRef);
    for (let index = 0; index < 4; index += 1)
      pass(session, `random-pass:${index}`);
    expect(session.handleTimeout("overflow-timeout").accepted).toBe(true);
    expect(
      session.state.randomHistory.some((record) =>
        record.purpose.startsWith("special.sp08.overflow.timeout"),
      ),
    ).toBe(true);
    expect(
      refs.filter((ref) => session.state.cards[ref]!.zoneRef === "discardPile"),
    ).toHaveLength(1);
  });
});
