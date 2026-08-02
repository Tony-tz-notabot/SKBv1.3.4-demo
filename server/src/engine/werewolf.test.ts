import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";
import {
  buildWerewolfNotebookOffers,
  WerewolfNotebookSession,
} from "./werewolf.js";

let ruleset: LoadedRuleset;
beforeAll(async () => {
  ruleset = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});
const COLORS = ["white", "green", "blue", "orange", "red"];
function ready() {
  let state = createInitialSetup(ruleset, {
    gameId: "werewolf",
    firstSeat: 1,
    seed: 719,
    usersBySeat: { 1: "u1", 2: "u2", 3: "u3", 4: "u4" },
    characterIdsBySeat: {
      1: "character.werewolf",
      2: "character.knight",
      3: "character.ranger",
      4: "character.wizard",
    },
  });
  for (const seat of [1, 2, 3, 4] as const)
    state = resolveInitialRedraw(state, seat, false, ruleset).state;
  state.activeSeat = 1;
  state.phase = "play";
  state.phaseBoundary = "body";
  state.phaseMode = "manual";
  state.phaseBodyResolved = false;
  state.pendingWindows = [
    {
      promptId: "play:werewolf",
      kind: "playPhaseAction",
      prioritySeat: 1,
      mandatory: false,
      deadlineAt: 1000,
      timeoutPolicy: "pass",
      legalOfferIds: ["offer:playPhaseAction:finish"],
      context: {},
    },
  ];
  return state;
}
function relocate(state: AuthoritativeGameState, ref: string, zoneRef: string) {
  const card = state.cards[ref]!,
    source = state.zones[card.zoneRef]!,
    target = state.zones[zoneRef]!;
  source.orderedCardRefs.splice(source.orderedCardRefs.indexOf(ref), 1);
  target.orderedCardRefs.push(ref);
  Object.assign(card, {
    zoneRef,
    ownerSeat: target.ownerSeat,
    controllerSeat: target.ownerSeat,
    faceUp: !zoneRef.startsWith("hand:"),
  });
}
function fiveColors(state: AuthoritativeGameState) {
  const facts = new Map(
      (
        ruleset.documents.get("cards.json") as {
          items: Array<{ cardId: string; color: string }>;
        }
      ).items.map((item) => [item.cardId, item.color]),
    ),
    refs = COLORS.map(
      (color) =>
        Object.values(state.cards).find(
          (card) =>
            facts.get(card.templateId) === color &&
            card.zoneRef !== "discardPile" &&
            !state.zones["hand:1"]!.orderedCardRefs.includes(card.cardRef),
        )!.cardRef,
    );
  for (const ref of refs) relocate(state, ref, "hand:1");
  return refs;
}
function use(state: AuthoritativeGameState, refs: string[], targetRef: string) {
  const session = new WerewolfNotebookSession(state, ruleset),
    window = state.pendingWindows[0]!;
  return {
    session,
    result: session.handle({
      commandId: `notebook:${state.stateRevision}`,
      gameId: state.gameId,
      expectedStateRevision: state.stateRevision,
      actorUserId: "u1",
      promptId: window.promptId,
      offerId: "offer:skill.werewolf.notebook",
      cardRefs: refs,
      targetRef,
    }),
  };
}

describe("Werewolf Notebook", () => {
  it("atomically pays five hand colors, raises max hp and then applies the shield branch", () => {
    const state = ready(),
      refs = fiveColors(state),
      actor = state.players[0]!,
      target = state.players[1]!;
    actor.hp = actor.maxHp! - 2;
    target.shield = 4;
    const beforeMax = actor.maxHp!,
      { session, result } = use(state, refs, "character:2");
    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error(result.reasonCode);
    expect(session.state.players[0]).toMatchObject({
      maxHp: beforeMax + 1,
      hp: beforeMax - 1,
      markers: { werewolfNotebookUses: 1 },
    });
    expect(session.state.players[1]!.shield).toBe(0);
    expect(
      refs.every((ref) => session.state.cards[ref]!.zoneRef === "discardPile"),
    ).toBe(true);
    expect(result.events.map((event) => event.eventType)).not.toContain(
      "damage.received",
    );
  });

  it("uses the hp branch without entering damage or dying and becomes unavailable after two uses", () => {
    let state = ready();
    state.players[1]!.shield = 0;
    state.players[1]!.hp = -3;
    let refs = fiveColors(state),
      first = use(state, refs, "character:2");
    state = first.session.state;
    expect(state.players[1]).toMatchObject({ hp: 1, lifeState: "alive" });
    refs = fiveColors(state);
    const second = use(state, refs, "character:2");
    state = second.session.state;
    expect(state.players[0]!.markers.werewolfNotebookUses).toBe(2);
    expect(buildWerewolfNotebookOffers(state, ruleset, 1)).toHaveLength(0);
  });

  it("rejects duplicate-color or non-hand cost selections without state pollution", () => {
    const state = ready(),
      refs = fiveColors(state),
      before = structuredClone(state),
      { result, session } = use(
        state,
        [refs[0]!, refs[0]!, ...refs.slice(2)],
        "character:2",
      );
    expect(result).toMatchObject({
      accepted: false,
      reasonCode: "COST_SELECTION_INVALID",
    });
    expect(session.state).toEqual(before);
  });
});
