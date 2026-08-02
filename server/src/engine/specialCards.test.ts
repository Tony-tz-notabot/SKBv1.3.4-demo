import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import {
  buildDeathNoteOffers,
  DeathNoteSession,
  HornSquadSession,
} from "./specialCards.js";
import { buildAttackOffer, commitAttack } from "./attack.js";
import { setWeaponPreselection } from "./preselection.js";
import { advanceTimeline } from "./timeline.js";

let ruleset: LoadedRuleset;
beforeAll(async () => {
  ruleset = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});
function ready() {
  let state = createInitialSetup(ruleset, {
    gameId: "special",
    firstSeat: 1,
    seed: 1103,
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
  const note = Object.values(state.cards).find(
      (card) => card.templateId === "special.sp04",
    )!,
    source = state.zones[note.zoneRef]!,
    hand = state.zones["hand:1"]!;
  source.orderedCardRefs.splice(
    source.orderedCardRefs.indexOf(note.cardRef),
    1,
  );
  hand.orderedCardRefs.push(note.cardRef);
  note.zoneRef = "hand:1";
  note.ownerSeat = 1;
  note.controllerSeat = 1;
  note.faceUp = false;
  state.activeSeat = 1;
  state.phase = "play";
  state.phaseBoundary = "body";
  state.phaseMode = "manual";
  state.phaseBodyResolved = false;
  state.pendingWindows = [
    {
      promptId: "play:special",
      kind: "playPhaseAction",
      prioritySeat: 1,
      mandatory: false,
      deadlineAt: 900,
      timeoutPolicy: "pass",
      legalOfferIds: ["offer:playPhaseAction:finish"],
      context: {},
    },
  ];
  return { state, note: note.cardRef };
}
function command(
  state: ReturnType<typeof ready>["state"],
  note: string,
  targetRef: string,
) {
  return {
    commandId: `note:${targetRef}`,
    gameId: state.gameId,
    expectedStateRevision: state.stateRevision,
    actorUserId: "u1",
    promptId: "play:special",
    offerId: `offer:special.sp04:${note}`,
    cardRef: note,
    targetRef,
  };
}
function relocate(
  state: ReturnType<typeof ready>["state"],
  templatePrefix: string,
  toZoneRef: string,
) {
  const card = Object.values(state.cards).find(
    (item) =>
      item.templateId.startsWith(templatePrefix) && item.zoneRef !== toZoneRef,
  )!;
  const from = state.zones[card.zoneRef]!,
    to = state.zones[toZoneRef]!;
  from.orderedCardRefs.splice(from.orderedCardRefs.indexOf(card.cardRef), 1);
  to.orderedCardRefs.push(card.cardRef);
  card.zoneRef = toZoneRef;
  card.ownerSeat = to.ownerSeat;
  card.controllerSeat = to.ownerSeat;
  card.faceUp = !toZoneRef.startsWith("hand:");
  return card.cardRef;
}
describe("ordinary special cards", () => {
  it("Death Note sets positive shield to zero as modification and remains idempotent", () => {
    const { state, note } = ready();
    state.players[1]!.shield = 3;
    state.players[1]!.hp = 4;
    const session = new DeathNoteSession(state, ruleset),
      cmd = command(state, note, "character:2"),
      first = session.handle(cmd);
    expect(first.accepted).toBe(true);
    expect(session.handle(cmd)).toEqual(first);
    expect(session.state.players[1]).toMatchObject({ shield: 0, hp: 4 });
    expect(session.state.cards[note]!.zoneRef).toBe("discardPile");
    expect(
      first.accepted &&
        first.events.some((event) => event.eventType === "damage.received"),
    ).toBe(false);
    expect(
      first.accepted &&
        first.events.find((event) => event.eventType === "value.changed")
          ?.payload,
    ).toMatchObject({ path: "shield", semantic: "modifyNotDamage" });
  });
  it("Death Note sets hp to one only when the target has no positive shield", () => {
    const { state, note } = ready();
    state.players[1]!.shield = 0;
    state.players[1]!.hp = 7;
    const session = new DeathNoteSession(state, ruleset),
      result = session.handle(command(state, note, "character:2"));
    expect(result.accepted).toBe(true);
    expect(session.state.players[1]).toMatchObject({
      shield: 0,
      hp: 1,
      lifeState: "alive",
    });
    expect(
      result.accepted && result.events.map((event) => event.eventType),
    ).not.toContain("dying.check");
  });
  it("revalidates card and target without mutating rejected state", () => {
    const { state, note } = ready(),
      session = new DeathNoteSession(state, ruleset),
      revision = state.stateRevision;
    expect(buildDeathNoteOffers(state, ruleset, 1)[0]).toMatchObject({
      cardRef: note,
      legalTargetRefs: [
        "character:1",
        "character:2",
        "character:3",
        "character:4",
      ],
    });
    const result = session.handle(command(state, note, "character:9"));
    expect(result).toMatchObject({
      accepted: false,
      reasonCode: "TARGET_NO_LONGER_LEGAL",
    });
    expect(session.state.stateRevision).toBe(revision);
    expect(session.state.cards[note]!.zoneRef).toBe("hand:1");
  });
  it("Horn Squad waives attack count only for a weapon attack that actually pays Kill", () => {
    let { state } = ready();
    const horn = relocate(state, "special.sp07", "hand:1"),
      session = new HornSquadSession(state, ruleset),
      first = session.handle({
        commandId: "horn",
        gameId: state.gameId,
        expectedStateRevision: state.stateRevision,
        actorUserId: "u1",
        promptId: "play:special",
        offerId: `offer:special.sp07:${horn}`,
        cardRef: horn,
      });
    expect(first.accepted).toBe(true);
    state = session.state;
    const weapon = relocate(state, "weapon.w01", "weapon:1:1"),
      kill = relocate(state, "basic.kill.", "hand:1");
    state = setWeaponPreselection(state, 1, "weapon:1:1", null, ruleset).state;
    state.players[0]!.limits.attackCountRemaining = 0;
    const offer = buildAttackOffer(state, 1, ruleset);
    expect(offer).toMatchObject({
      attackCountAvailable: 0,
      attackCountCost: 0,
      payable: true,
    });
    const committed = commitAttack(state, ruleset, {
      attackerSeat: 1,
      targetRefs: ["character:2"],
      killCardRefs: [kill],
    });
    expect(committed.state.players[0]!.limits.attackCountRemaining).toBe(0);
    expect(
      committed.events.find((event) => event.eventType === "attack.costs.paid")
        ?.payload,
    ).toMatchObject({
      attackCount: 0,
      printedAttackCountCost: 1,
      hornSquadApplied: true,
    });
    expect(committed.state.cards[weapon]!.zoneRef).toBe("weapon:1:1");
  });
  it("Horn Squad does not waive Hand Knife and expires before a skipped next prepare", () => {
    let { state } = ready();
    const horn = relocate(state, "special.sp07", "hand:1"),
      session = new HornSquadSession(state, ruleset);
    session.handle({
      commandId: "horn-expiry",
      gameId: state.gameId,
      expectedStateRevision: state.stateRevision,
      actorUserId: "u1",
      promptId: "play:special",
      offerId: `offer:special.sp07:${horn}`,
      cardRef: horn,
    });
    state = session.state;
    state.durations.push({
      durationId: "duration:unrelated",
      sourceRef: null,
      ownerRef: "character:1",
      anchorEventId: null,
      activationPoint: "test",
      expiryPoint: "owner.nextPhase.prepare.before",
      remainingCount: null,
      countScope: "owner",
      skipPolicy: "expireOnSkippedBoundary",
      sourceLeavePolicy: "continue",
      ownerEliminatedPolicy: "cancel",
      cleanupEffects: [],
    });
    for (const zoneRef of ["weapon:1:1", "weapon:1:2", "weapon:1:3"]) {
      for (const ref of [...state.zones[zoneRef]!.orderedCardRefs]) {
        state.zones[zoneRef]!.orderedCardRefs.splice(
          state.zones[zoneRef]!.orderedCardRefs.indexOf(ref),
          1,
        );
        state.zones.outsideDeck!.orderedCardRefs.push(ref);
        state.cards[ref]!.zoneRef = "outsideDeck";
        state.cards[ref]!.ownerSeat = null;
        state.cards[ref]!.controllerSeat = null;
      }
    }
    state = setWeaponPreselection(state, 1, "weapon:1:1", null, ruleset).state;
    state.players[0]!.limits.attackCountRemaining = 0;
    expect(buildAttackOffer(state, 1, ruleset)).toMatchObject({
      source: { kind: "handKnife" },
      attackCountCost: 1,
      payable: false,
    });
    state.pendingWindows = [];
    state.activeSeat = 4;
    state.phase = "end";
    state.phaseBoundary = "body";
    state.phaseMode = "automatic";
    state.phaseBodyResolved = true;
    const advanced = advanceTimeline(
      state,
      { kind: "skip", reason: "test" },
      ruleset,
    );
    expect(advanced.state).toMatchObject({
      activeSeat: 1,
      phase: "prepare",
      phaseBoundary: "after",
    });
    expect(advanced.state.players[0]!.markers.hornSquadActive).toBeUndefined();
    expect(
      advanced.state.durations.some((item) =>
        item.durationId.includes("horn-squad"),
      ),
    ).toBe(false);
    expect(
      advanced.state.durations.some(
        (item) => item.durationId === "duration:unrelated",
      ),
    ).toBe(true);
  });
});
