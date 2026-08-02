import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import {
  C6FocusedBombardmentSession,
  C6LaserSweepSession,
  commitC6FocusedBombardment,
  commitC6LaserSweep,
  openC6BombardmentAtPlayAfter,
} from "./c6h8o6.js";
import { runAutomaticScheduler } from "./automaticScheduler.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { EngineTransaction } from "./transaction.js";
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
function relocate(s: AuthoritativeGameState, ref: string, to: string) {
  const card = s.cards[ref]!,
    from = s.zones[card.zoneRef]!;
  from.orderedCardRefs.splice(from.orderedCardRefs.indexOf(ref), 1);
  s.zones[to]!.orderedCardRefs.push(ref);
  card.zoneRef = to;
  card.ownerSeat = s.zones[to]!.ownerSeat;
  card.controllerSeat = s.zones[to]!.ownerSeat;
  card.faceUp = s.zones[to]!.zoneType !== "hand";
}
function ready() {
  let s = createInitialSetup(ruleset, {
    gameId: "c6",
    firstSeat: 1,
    seed: 179,
    usersBySeat: users,
    characterIdsBySeat: characters,
  });
  for (const seat of [1, 2, 3, 4] as const)
    s = resolveInitialRedraw(s, seat, false, ruleset).state;
  s.phase = "play";
  s.phaseBoundary = "body";
  s.phaseMode = "manual";
  s.phaseBodyResolved = false;
  s.pendingWindows = [
    {
      promptId: "play",
      kind: "playPhaseAction",
      prioritySeat: 1,
      mandatory: false,
      deadlineAt: 900,
      timeoutPolicy: "pass",
      legalOfferIds: ["finish"],
      context: {},
    },
  ];
  s.players[0]!.limits[ruleset.settings.combat.attackCountLimitId] = 1;
  for (const p of s.players) {
    p.shield = 10;
    p.hp = 10;
  }
  const c6 = Object.values(s.cards).find(
    (c) => c.templateId === "boss.c6h8o6",
  )!.cardRef;
  relocate(s, c6, "hand:1");
  return { s, c6 };
}
function answer(session: C6LaserSweepSession, seat: Seat, play = false) {
  const w = session.state.pendingWindows[0]!,
    card = play
      ? (w.context?.legalCardRefs as string[] | undefined)?.[0]
      : undefined;
  return session.handle({
    commandId: `c6-${seat}-${play}`,
    gameId: session.state.gameId,
    expectedStateRevision: session.state.stateRevision,
    actorUserId: `u${seat}`,
    promptId: w.promptId,
    offerId: w.legalOfferIds.find((id) =>
      id.includes(play ? ":play:" : ":pass:"),
    )!,
    ...(card ? { cardRef: card } : {}),
  });
}
describe("C6H8O6 laser sweep", () => {
  it("validates and pays one attack count only when the branch commits", () => {
    const { s, c6 } = ready();
    s.players[0]!.limits[ruleset.settings.combat.attackCountLimitId] = 0;
    expect(() =>
      commitC6LaserSweep(s, ruleset, {
        actorSeat: 1,
        cardRef: c6,
        family: "kill",
        deadlineAt: 900,
      }),
    ).toThrow("C6_ATTACK_COUNT_UNAVAILABLE");
    expect(s.cards[c6]!.zoneRef).toBe("hand:1");
    expect(s.players[0]!.markers["boss.lastUsedGlobalTurn"]).toBeUndefined();
  });
  it("collects all passes before dealing two laser damage to each responder", () => {
    const { s, c6 } = ready(),
      committed = commitC6LaserSweep(s, ruleset, {
        actorSeat: 1,
        cardRef: c6,
        family: "kill",
        deadlineAt: 900,
      }),
      session = new C6LaserSweepSession(committed.state, ruleset);
    for (const seat of [2, 3, 4] as const)
      expect(answer(session, seat).accepted).toBe(true);
    expect(session.state.players.slice(1).map((p) => p.shield)).toEqual([
      10, 10, 10,
    ]);
    const run = runAutomaticScheduler(session.state, ruleset, () => 900);
    expect(run.state.players.slice(1).map((p) => p.shield)).toEqual([8, 8, 8]);
    expect(run.state.pendingWindows[0]).toMatchObject({
      kind: "playPhaseAction",
      prioritySeat: 1,
    });
    expect(run.state.cards[c6]!.zoneRef).toBe("discardPile");
  });
  it("accepts one matching physical card and locks three damage for the other two", () => {
    const { s, c6 } = ready(),
      kill = Object.values(s.cards).find(
        (c) => c.templateId.startsWith("basic.kill.") && c.zoneRef !== `hand:2`,
      )!.cardRef;
    relocate(s, kill, "hand:2");
    const session = new C6LaserSweepSession(
      commitC6LaserSweep(s, ruleset, {
        actorSeat: 1,
        cardRef: c6,
        family: "kill",
        deadlineAt: 900,
      }).state,
      ruleset,
    );
    expect(answer(session, 2, true).accepted).toBe(true);
    answer(session, 3);
    answer(session, 4);
    const run = runAutomaticScheduler(session.state, ruleset, () => 900);
    expect(run.state.players.slice(1).map((p) => p.shield)).toEqual([10, 7, 7]);
    expect(run.state.cards[kill]!.zoneRef).toBe("discardPile");
  });
});
function triggerBombard(s: AuthoritativeGameState) {
  const tx = new EngineTransaction(s);
  openC6BombardmentAtPlayAfter(tx, ruleset, 2, 950);
  const out = tx.commit();
  out.state.history.domainEvents.push(...out.events);
  return out.state;
}
describe("C6H8O6 focused bombardment", () => {
  it("checks slot legality before payment and stores its delayed target", () => {
    const { s, c6 } = ready(),
      other = Object.values(s.cards).find(
        (c) => c.templateId === "boss.purple_lord",
      )!.cardRef;
    relocate(s, other, "boss:1");
    expect(() =>
      commitC6FocusedBombardment(s, ruleset, {
        actorSeat: 1,
        cardRef: c6,
        family: "dodge",
        targetSeat: 2,
      }),
    ).toThrow("BOSS_SLOT_OCCUPIED");
    expect(
      s.players[0]!.limits[ruleset.settings.combat.attackCountLimitId],
    ).toBe(1);
    relocate(s, other, "discardPile");
    const out = commitC6FocusedBombardment(s, ruleset, {
      actorSeat: 1,
      cardRef: c6,
      family: "dodge",
      targetSeat: 2,
    });
    expect(out.state.cards[c6]).toMatchObject({
      zoneRef: "boss:1",
      runtime: {
        modeId: "focusedBombardment",
        targetSeat: 2,
        requestedFamily: "dodge",
        triggered: false,
      },
    });
  });
  it("makes two requests and deals five field damage after two passes", () => {
    let { s, c6 } = ready();
    s = commitC6FocusedBombardment(s, ruleset, {
      actorSeat: 1,
      cardRef: c6,
      family: "dodge",
      targetSeat: 2,
    }).state;
    s.pendingWindows = [];
    const session = new C6FocusedBombardmentSession(triggerBombard(s), ruleset);
    expect(session.handleTimeout("pass-1").accepted).toBe(true);
    expect(session.state.pendingWindows[0]).toMatchObject({
      kind: "c6FocusedBombardmentRequest",
      context: { requestIndex: 2 },
    });
    expect(session.handleTimeout("pass-2").accepted).toBe(true);
    expect(session.state.cards[c6]!.zoneRef).toBe("discardPile");
    const run = runAutomaticScheduler(session.state, ruleset, () => 950);
    expect(run.state.players[1]!.shield).toBe(5);
  });
  it("deals two after exactly one matching response and zero after two", () => {
    for (const played of [1, 2]) {
      let { s, c6 } = ready();
      const refs = Object.values(s.cards)
        .filter((c) => c.templateId.startsWith("basic.kill."))
        .slice(0, 2)
        .map((c) => c.cardRef);
      refs.forEach((ref) => relocate(s, ref, "hand:2"));
      s = commitC6FocusedBombardment(s, ruleset, {
        actorSeat: 1,
        cardRef: c6,
        family: "kill",
        targetSeat: 2,
      }).state;
      s.pendingWindows = [];
      const session = new C6FocusedBombardmentSession(
        triggerBombard(s),
        ruleset,
      );
      for (let i = 0; i < 2; i++) {
        const w = session.state.pendingWindows[0]!,
          yes = i < played,
          card = (w.context?.legalCardRefs as string[])[0];
        session.handle({
          commandId: `bomb-${played}-${i}`,
          gameId: s.gameId,
          expectedStateRevision: session.state.stateRevision,
          actorUserId: "u2",
          promptId: w.promptId,
          offerId: w.legalOfferIds.find((id) =>
            id.includes(yes ? ":play:" : ":pass:"),
          )!,
          ...(yes ? { cardRef: card } : {}),
        });
      }
      const run = runAutomaticScheduler(session.state, ruleset, () => 950);
      expect(run.state.players[1]!.shield).toBe(played === 1 ? 8 : 10);
    }
  });
  it("cancels when the stored target has left play", () => {
    let { s, c6 } = ready();
    s = commitC6FocusedBombardment(s, ruleset, {
      actorSeat: 1,
      cardRef: c6,
      family: "kill",
      targetSeat: 2,
    }).state;
    s.pendingWindows = [];
    s.players[1]!.presence = "leftPlay";
    const out = triggerBombard(s);
    expect(out.pendingWindows).toHaveLength(0);
    expect(out.cards[c6]!.zoneRef).toBe("discardPile");
  });
});
