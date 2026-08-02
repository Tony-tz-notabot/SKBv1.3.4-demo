import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import {
  addDrawCountModifierInTransaction,
  drawCountModifiers,
} from "./drawCount.js";
import { ForesightSession } from "./foresight.js";
import { resolvePhaseBody } from "./phaseBody.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import { handCards } from "./state.js";
import { EngineTransaction } from "./transaction.js";

let ruleset: LoadedRuleset;
beforeAll(async () => {
  ruleset = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});
function ready() {
  let state = createInitialSetup(ruleset, {
    gameId: "foresight",
    firstSeat: 1,
    seed: 977,
    usersBySeat: { 1: "u1", 2: "u2", 3: "u3", 4: "u4" },
    characterIdsBySeat: {
      1: "character.shaman",
      2: "character.alchemist",
      3: "character.ranger",
      4: "character.wizard",
    },
  });
  for (const seat of [1, 2, 3, 4] as const)
    state = resolveInitialRedraw(state, seat, false, ruleset).state;
  state.phase = "draw";
  state.phaseBoundary = "body";
  state.phaseMode = "automatic";
  state.phaseBodyResolved = false;
  return state;
}
function addModifier(state: ReturnType<typeof ready>, delta: number) {
  const tx = new EngineTransaction(state);
  addDrawCountModifierInTransaction(tx, {
    seat: 1,
    modifierId: `test:${delta}`,
    delta,
    remainingAffectedDraws: 1,
  });
  const committed = tx.commit();
  committed.state.history.domainEvents.push(...committed.events);
  return committed.state;
}
describe("Shaman Foresight", () => {
  it("privately displays N+2, obtains exactly N and discards the remainder", () => {
    const initial = ready(),
      handBefore = handCards(initial, 1).length,
      opened = resolvePhaseBody(initial, ruleset, 800).state,
      window = opened.pendingWindows[0]!,
      shown = window.context!.cardRefs as string[];
    expect(window).toMatchObject({
      kind: "foresightDrawChoice",
      prioritySeat: 1,
      mandatory: true,
      context: { requestedDrawCount: 2, requiredCount: 2 },
    });
    expect(shown).toHaveLength(4);
    expect(
      shown.every(
        (ref) =>
          opened.cards[ref]!.zoneRef === "resolving" &&
          opened.cards[ref]!.faceUp === false,
      ),
    ).toBe(true);
    const session = new ForesightSession(opened),
      command = {
        commandId: "choose",
        gameId: opened.gameId,
        expectedStateRevision: opened.stateRevision,
        actorUserId: "u1",
        promptId: window.promptId,
        offerId: "offer:foresight:submit",
        cardRefs: shown.slice(0, 2),
      },
      result = session.handle(command);
    expect(result.accepted).toBe(true);
    expect(session.handle(command)).toEqual(result);
    expect(handCards(session.state, 1)).toHaveLength(handBefore + 2);
    expect(
      shown
        .slice(2)
        .every((ref) => session.state.cards[ref]!.zoneRef === "discardPile"),
    ).toBe(true);
    expect(session.state.phaseBodyResolved).toBe(true);
  });
  it("still displays two when N is zero, chooses none, and consumes the modifier", () => {
    const opened = resolvePhaseBody(
        addModifier(ready(), -2),
        ruleset,
        800,
      ).state,
      window = opened.pendingWindows[0]!,
      shown = window.context!.cardRefs as string[];
    expect(window.context).toMatchObject({
      requestedDrawCount: 0,
      requiredCount: 0,
    });
    expect(shown).toHaveLength(2);
    const session = new ForesightSession(opened),
      result = session.handle({
        commandId: "zero",
        gameId: opened.gameId,
        expectedStateRevision: opened.stateRevision,
        actorUserId: "u1",
        promptId: window.promptId,
        offerId: "offer:foresight:submit",
        cardRefs: [],
      });
    expect(result.accepted).toBe(true);
    expect(
      shown.every((ref) => session.state.cards[ref]!.zoneRef === "discardPile"),
    ).toBe(true);
    expect(drawCountModifiers(session.state, 1)).toHaveLength(0);
  });
  it("rejects an incomplete choice without mutation and times out reproducibly across a reshuffle", () => {
    const state = ready(),
      draw = state.zones.drawPile!,
      discard = state.zones.discardPile!,
      moved = draw.orderedCardRefs.splice(1);
    discard.orderedCardRefs.push(...moved);
    for (const ref of moved) {
      state.cards[ref]!.zoneRef = "discardPile";
      state.cards[ref]!.faceUp = true;
    }
    const openedCommit = resolvePhaseBody(state, ruleset, 800),
      opened = openedCommit.state,
      window = opened.pendingWindows[0]!,
      shown = window.context!.cardRefs as string[];
    expect(openedCommit.events.map((event) => event.eventType)).toContain(
      "deck.reshuffled",
    );
    expect(shown).toHaveLength(4);
    const session = new ForesightSession(opened),
      revision = opened.stateRevision,
      rejected = session.handle({
        commandId: "bad",
        gameId: opened.gameId,
        expectedStateRevision: revision,
        actorUserId: "u1",
        promptId: window.promptId,
        offerId: "offer:foresight:submit",
        cardRefs: [shown[0]!],
      });
    expect(rejected).toMatchObject({
      accepted: false,
      reasonCode: "FORESIGHT_SELECTION_INVALID",
    });
    expect(session.state.stateRevision).toBe(revision);
    const timed = session.handleTimeout("timeout");
    expect(timed.accepted).toBe(true);
    expect(session.state.randomHistory.at(-1)?.purpose).toBe(
      "timeout.foresight",
    );
    expect(handCards(session.state, 1)).toEqual(
      expect.arrayContaining(session.state.randomHistory.at(-1)!.resultRefs),
    );
  });
});
