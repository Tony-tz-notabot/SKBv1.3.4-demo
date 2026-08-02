import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { BloodAltarSession, buildBloodAltarOffers } from "./bloodAltar.js";
import { openDyingRescue } from "./dying.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import { advanceTimeline } from "./timeline.js";

let ruleset: LoadedRuleset;

beforeAll(async () => {
  ruleset = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});

function ready() {
  let state = createInitialSetup(ruleset, {
    gameId: "blood-altar",
    firstSeat: 1,
    seed: 4911,
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
  const altar = Object.values(state.cards).find(
      (card) => card.templateId === "special.sp11",
    )!,
    source = state.zones[altar.zoneRef]!,
    hand = state.zones["hand:1"]!;
  source.orderedCardRefs.splice(
    source.orderedCardRefs.indexOf(altar.cardRef),
    1,
  );
  hand.orderedCardRefs.push(altar.cardRef);
  Object.assign(altar, {
    zoneRef: "hand:1",
    ownerSeat: 1,
    controllerSeat: 1,
    faceUp: false,
  });
  state.activeSeat = 1;
  state.phase = "play";
  state.phaseBoundary = "body";
  state.phaseMode = "manual";
  state.phaseBodyResolved = false;
  state.pendingWindows = [
    {
      promptId: "play:blood-altar",
      kind: "playPhaseAction",
      prioritySeat: 1,
      mandatory: false,
      deadlineAt: 900,
      timeoutPolicy: "pass",
      legalOfferIds: ["offer:playPhaseAction:finish"],
      context: {},
    },
  ];
  return { state, altar: altar.cardRef };
}

function use(state: ReturnType<typeof ready>["state"], altar: string) {
  return {
    commandId: `altar:${state.stateRevision}`,
    gameId: state.gameId,
    expectedStateRevision: state.stateRevision,
    actorUserId: "u1",
    promptId: "play:blood-altar",
    offerId: `offer:special.sp11:${altar}`,
    cardRef: altar,
  };
}

describe("Blood Altar", () => {
  it("modifies max hp and hp, creates only the required iron shield contribution, and is idempotent", () => {
    const { state, altar } = ready();
    const owner = state.players[0]!;
    owner.maxHp = 6;
    owner.hp = 6;
    owner.ironShield = 0;
    const session = new BloodAltarSession(state, ruleset),
      command = use(state, altar),
      first = session.handle(command);
    expect(first.accepted).toBe(true);
    expect(session.handle(command)).toEqual(first);
    expect(session.state.players[0]).toMatchObject({
      maxHp: 4,
      hp: 2,
      ironShield: 1,
      lifeState: "alive",
    });
    expect(session.state.cards[altar]!.zoneRef).toBe("discardPile");
    expect(
      first.accepted && first.events.map((event) => event.eventType),
    ).not.toContain("damage.received");
    expect(
      first.accepted &&
        first.events.filter((event) => event.eventType === "value.changed"),
    ).toHaveLength(2);
  });

  it("does not manufacture or later remove iron shield when the owner already has more than one", () => {
    let { state, altar } = ready();
    state.players[0]!.ironShield = 3;
    const session = new BloodAltarSession(state, ruleset);
    session.handle(use(state, altar));
    state = session.state;
    expect(state.players[0]!.ironShield).toBe(3);
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
    expect(advanced.state.players[0]).toMatchObject({
      ironShield: 3,
      markers: { bloodCurseEnabled: true },
    });
  });

  it("enters the unified dying flow immediately and suspends the play window", () => {
    const { state, altar } = ready();
    state.players[0]!.maxHp = 3;
    state.players[0]!.hp = 2;
    const session = new BloodAltarSession(state, ruleset),
      result = session.handle(use(state, altar));
    expect(result.accepted).toBe(true);
    expect(session.state.players[0]).toMatchObject({
      maxHp: 1,
      hp: -1,
      lifeState: "dying",
      ironShield: 1,
    });
    expect(session.state.pendingWindows).toHaveLength(0);
    expect(session.state.combat.dyingStack).toEqual(["character:1"]);
    const rescue = openDyingRescue(session.state, 1000, ruleset);
    expect(rescue.state.pendingWindows[0]).toMatchObject({
      kind: "dyingRescue",
      prioritySeat: 1,
    });
  });

  it("expires before a skipped prepare, grants Blood Curse only while still in play, and preserves unrelated durations", () => {
    let { state, altar } = ready();
    const session = new BloodAltarSession(state, ruleset);
    session.handle(use(state, altar));
    state = session.state;
    state.durations.push({
      durationId: "duration:unrelated-blood-test",
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
    expect(advanced.state.players[0]).toMatchObject({
      ironShield: 0,
      markers: { bloodCurseEnabled: true },
    });
    expect(
      advanced.state.durations.some(
        (duration) => duration.durationId === "duration:unrelated-blood-test",
      ),
    ).toBe(true);
  });

  it("does not grant Blood Curse after the owner leaves play and rejects an expired offer without mutation", () => {
    let { state, altar } = ready();
    expect(buildBloodAltarOffers(state, ruleset, 1)).toHaveLength(1);
    const session = new BloodAltarSession(state, ruleset);
    session.handle(use(state, altar));
    state = session.state;
    state.players[0]!.presence = "leftPlay";
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
    expect(
      advanced.state.players[0]!.markers.bloodCurseEnabled,
    ).toBeUndefined();

    const fresh = ready(),
      rejectedSession = new BloodAltarSession(fresh.state, ruleset),
      revision = fresh.state.stateRevision,
      rejected = rejectedSession.handle({
        ...use(fresh.state, fresh.altar),
        offerId: "offer:special.sp11:missing",
      });
    expect(rejected).toMatchObject({
      accepted: false,
      reasonCode: "OFFER_EXPIRED",
    });
    expect(rejectedSession.state.stateRevision).toBe(revision);
    expect(rejectedSession.state.cards[fresh.altar]!.zoneRef).toBe("hand:1");
  });
});
