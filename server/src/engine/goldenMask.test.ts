import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { runAutomaticScheduler } from "./automaticScheduler.js";
import { GoldenMaskTargetSession } from "./goldenMask.js";
import { JudgmentInterventionSession } from "./judgmentIntervention.js";
import { AttackResponseSession } from "./response.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";
import { advanceTimeline } from "./timeline.js";

let ruleset: LoadedRuleset;
beforeAll(async () => {
  ruleset = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});

function relocateTop(state: AuthoritativeGameState, ref: string, to: string) {
  const card = state.cards[ref]!;
  state.zones[card.zoneRef]!.orderedCardRefs.splice(
    state.zones[card.zoneRef]!.orderedCardRefs.indexOf(ref),
    1,
  );
  state.zones[to]!.orderedCardRefs.unshift(ref);
  card.zoneRef = to;
  card.ownerSeat = state.zones[to]!.ownerSeat;
  card.controllerSeat = state.zones[to]!.ownerSeat;
  card.faceUp = !["drawPile", "hand"].includes(state.zones[to]!.zoneType);
}

function ready(color: "white" | "green" | "blue" | "orange" | "red") {
  let state = createInitialSetup(ruleset, {
    gameId: `golden-mask-${color}`,
    firstSeat: 1,
    seed: 331,
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
  const boss = Object.values(state.cards).find(
      (card) => card.templateId === "boss.golden_mask",
    )!.cardRef,
    colors = new Map(
      (
        ruleset.documents.get("cards.json") as {
          items: Array<{ cardId: string; color: string }>;
        }
      ).items.map((card) => [card.cardId, card.color]),
    ),
    judgment = Object.values(state.cards).find(
      (card) => colors.get(card.templateId) === color && card.cardRef !== boss,
    )!.cardRef;
  relocateTop(state, boss, "boss:1");
  state.cards[boss]!.runtime = {
    active: true,
    activationStatus: "active",
    ownerTurnOrdinal: 1,
  };
  relocateTop(state, judgment, "drawPile");
  state.lifecycle = "inProgress";
  state.setup = { ...state.setup!, firstSeat: 1 };
  state.activeSeat = 1;
  state.round = 1;
  state.phase = "judgment";
  state.phaseBoundary = "body";
  state.phaseMode = "automatic";
  state.phaseBodyResolved = true;
  state.pendingWindows = [];
  return { state, boss };
}

function finishBranchJudgment(state: AuthoritativeGameState) {
  const session = new JudgmentInterventionSession(state, ruleset);
  for (let index = 0; index < 4; index++) {
    const window = session.state.pendingWindows.find(
      (item) => item.kind === "judgmentIntervention",
    )!;
    session.handle({
      commandId: `judge-pass-${index}`,
      gameId: state.gameId,
      expectedStateRevision: session.state.stateRevision,
      actorUserId: `u${window.prioritySeat}`,
      promptId: window.promptId,
      offerId: window.legalOfferIds[0]!,
    });
  }
  return session.state;
}

function forceTopColor(state: AuthoritativeGameState, color: string) {
  const colors = new Map(
      (
        ruleset.documents.get("cards.json") as {
          items: Array<{ cardId: string; color: string }>;
        }
      ).items.map((card) => [card.cardId, card.color]),
    ),
    ref = Object.values(state.cards).find(
      (card) =>
        colors.get(card.templateId) === color && card.zoneRef !== "resolving",
    )!.cardRef;
  relocateTop(state, ref, "drawPile");
}

function chooseSeatTwo(state: AuthoritativeGameState) {
  const window = state.pendingWindows[0]!,
    session = new GoldenMaskTargetSession(state, ruleset);
  session.handle({
    commandId: `target-${String(window.context?.templateId)}`,
    gameId: state.gameId,
    expectedStateRevision: state.stateRevision,
    actorUserId: "u1",
    promptId: window.promptId,
    offerId: window.legalOfferIds.find((id) => id.endsWith("character:2"))!,
    targetRef: "character:2",
  });
  return session.state;
}

describe("Golden Mask chaos strike", () => {
  it("replaces an actual draw phase, and white completes without an attack", () => {
    const entered = advanceTimeline(
      ready("white").state,
      { kind: "normal" },
      ruleset,
      800,
    );
    expect(entered.state).toMatchObject({
      phase: "draw",
      phaseBoundary: "after",
      phaseBodyResolved: true,
    });
    expect(entered.events.map((event) => event.eventType)).toContain(
      "phase.replace",
    );
    expect(
      entered.events.some(
        (event) =>
          event.eventType === "phase.after" &&
          (event.payload as Record<string, unknown>).phase === "draw",
      ),
    ).toBe(false);
    const completed = finishBranchJudgment(entered.state);
    expect(completed.pendingWindows).toHaveLength(0);
    expect(completed.combat.attack).toBeNull();
    expect(completed.history.domainEvents.at(-2)?.eventType).toBe(
      "phase.after",
    );
  });

  it("does not replace a draw phase already skipped by another effect", () => {
    const result = advanceTimeline(
      ready("green").state,
      { kind: "skip", reason: "otherEffect" },
      ruleset,
      800,
    );
    expect(result.events.map((event) => event.eventType)).toContain(
      "phase.skip",
    );
    expect(result.state.resolutionStack).toHaveLength(0);
  });

  it("creates the green ranged 1x3 attack and completes phase after combat", () => {
    let state = advanceTimeline(
      ready("green").state,
      { kind: "normal" },
      ruleset,
      800,
    ).state;
    state = finishBranchJudgment(state);
    const window = state.pendingWindows[0]!,
      target = new GoldenMaskTargetSession(state, ruleset);
    target.handle({
      commandId: "target-green",
      gameId: state.gameId,
      expectedStateRevision: state.stateRevision,
      actorUserId: "u1",
      promptId: window.promptId,
      offerId: window.legalOfferIds.find((id) => id.endsWith("character:2"))!,
      targetRef: "character:2",
    });
    expect(target.state.combat.attack).toMatchObject({
      modeId: "pineapple",
      attackTypes: ["ranged"],
      damageSegments: [expect.objectContaining({ amount: 1, repeat: 3 })],
    });
    state = runAutomaticScheduler(target.state, ruleset, () => 800).state;
    const response = state.pendingWindows[0]!,
      responseSession = new AttackResponseSession(state, ruleset);
    responseSession.handle({
      commandId: "attack-pass",
      gameId: state.gameId,
      expectedStateRevision: state.stateRevision,
      actorUserId: "u2",
      promptId: response.promptId,
      offerId: response.legalOfferIds.find((id) => id.includes(":pass:"))!,
    });
    const completed = runAutomaticScheduler(
      responseSession.state,
      ruleset,
      () => 800,
    );
    expect(completed.state.players[1]!.shield).toBe(2);
    expect(completed.state.combat.attack).toBeNull();
    expect(
      completed.state.history.domainEvents.some(
        (event) =>
          event.eventType === "phase.after" &&
          (event.payload as Record<string, unknown>).phase === "draw",
      ),
    ).toBe(true);
  });

  it("times out as a voluntary no-attack choice", () => {
    let state = advanceTimeline(
      ready("blue").state,
      { kind: "normal" },
      ruleset,
      800,
    ).state;
    state = finishBranchJudgment(state);
    const session = new GoldenMaskTargetSession(state, ruleset);
    expect(session.handleTimeout("timeout").accepted).toBe(true);
    expect(session.state.combat.attack).toBeNull();
    expect(session.state.pendingWindows).toHaveLength(0);
  });

  it("runs the orange hit judgment and adds one fire damage on red or orange", () => {
    let state = advanceTimeline(
      ready("orange").state,
      { kind: "normal" },
      ruleset,
      800,
    ).state;
    state = chooseSeatTwo(finishBranchJudgment(state));
    forceTopColor(state, "red");
    let scheduled = runAutomaticScheduler(state, ruleset, () => 800);
    expect(scheduled.stoppedReason).toBe("resolutionStack");
    state = finishBranchJudgment(scheduled.state);
    scheduled = runAutomaticScheduler(state, ruleset, () => 800);
    expect(scheduled.state.players[1]!.shield).toBe(2);
    expect(
      scheduled.state.history.domainEvents.some(
        (event) =>
          event.eventType === "damage.segment.added" ||
          (event.eventType === "damage.finalized" &&
            (event.payload as Record<string, unknown>).element === "fire"),
      ),
    ).toBe(true);
  });

  it("applies electrified after the red field attack hits", () => {
    let state = advanceTimeline(
      ready("red").state,
      { kind: "normal" },
      ruleset,
      800,
    ).state;
    state = chooseSeatTwo(finishBranchJudgment(state));
    const completed = runAutomaticScheduler(state, ruleset, () => 800);
    expect(completed.state.players[1]!.statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ statusId: "status.electrified" }),
      ]),
    );
  });
});
