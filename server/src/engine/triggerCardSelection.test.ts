import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";
import {
  processCommittedEventTriggers,
  processEventTriggers,
} from "./triggerBridge.js";
import { TriggerCardSelectionSession } from "./triggerCardSelection.js";
import { moveCard, moveCardAndProcessTriggers } from "./zones.js";

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
function started() {
  let state = createInitialSetup(ruleset, {
    gameId: "trigger-card",
    firstSeat: 1,
    seed: 113,
    usersBySeat: users,
    characterIdsBySeat: characters,
  });
  for (const seat of [1, 2, 3, 4] as const)
    state = resolveInitialRedraw(state, seat, false, ruleset).state;
  return state;
}
function equip(
  state: AuthoritativeGameState,
  templateId: string,
  zoneRef: string,
) {
  const card = Object.values(state.cards).find(
    (item) => item.templateId === templateId,
  )!;
  return moveCard(state, {
    cardRef: card.cardRef,
    toZoneRef: zoneRef,
    moveKind: "equip",
  }).state;
}

describe("trigger card selection", () => {
  it("opens mandatory Triple Wield cleanup and discards exactly one selected regular weapon", () => {
    let state = started();
    state = equip(state, "talent.triple_wield", "talent:1");
    const weapons = Object.values(state.cards)
      .filter((card) => card.templateId.startsWith("weapon."))
      .slice(0, 3);
    weapons.forEach((weapon, index) => {
      state = moveCard(state, {
        cardRef: weapon.cardRef,
        toZoneRef: `weapon:${index + 1}:1`,
        moveKind: "equip",
      }).state;
    });
    const talentRef = state.zones["talent:1"]!.orderedCardRefs[0]!,
      opened = moveCardAndProcessTriggers(
        state,
        ruleset,
        { cardRef: talentRef, toZoneRef: "discardPile", moveKind: "discard" },
        900,
      );
    expect(opened.triggerStopReason).toBe("specializedSelection");
    const window = opened.state.pendingWindows[0]!;
    expect(window).toMatchObject({
      kind: "triggerCardSelection",
      prioritySeat: 1,
      mandatory: true,
      timeoutPolicy: "randomLegal",
    });
    const selectedRef = (window.context!.legalCardRefs as string[])[1]!,
      session = new TriggerCardSelectionSession(opened.state, ruleset),
      command = {
        commandId: "triple-select",
        gameId: state.gameId,
        expectedStateRevision: opened.state.stateRevision,
        actorUserId: "u1",
        promptId: window.promptId,
        offerId: window.legalOfferIds[1]!,
      },
      result = session.handle(command);
    expect(result.accepted).toBe(true);
    expect(session.state.cards[selectedRef]!.zoneRef).toBe("discardPile");
    expect(
      Object.values(session.state.zones)
        .filter(
          (zone) => zone.ownerSeat === 1 && zone.zoneType === "weaponSlot",
        )
        .flatMap((zone) => zone.orderedCardRefs),
    ).toHaveLength(2);
    expect(
      result.accepted && result.events.map((event) => event.eventType),
    ).toEqual(
      expect.arrayContaining([
        "card.moved",
        "card.lost",
        "card.discarded",
        "trigger.resolved",
      ]),
    );
    expect(session.handle(command)).toEqual(result);
  });
  it("uses recorded random selection when mandatory Triple Wield cleanup times out", () => {
    let state = started();
    state = equip(state, "talent.triple_wield", "talent:1");
    const weapons = Object.values(state.cards)
      .filter((card) => card.templateId.startsWith("weapon."))
      .slice(0, 3);
    weapons.forEach((weapon, index) => {
      state = moveCard(state, {
        cardRef: weapon.cardRef,
        toZoneRef: `weapon:${index + 1}:1`,
        moveKind: "equip",
      }).state;
    });
    const opened = moveCardAndProcessTriggers(
        state,
        ruleset,
        {
          cardRef: state.zones["talent:1"]!.orderedCardRefs[0]!,
          toZoneRef: "discardPile",
          moveKind: "discard",
        },
        900,
      ),
      session = new TriggerCardSelectionSession(opened.state, ruleset);
    expect(session.handleTimeout("triple-timeout").accepted).toBe(true);
    expect(session.state.randomHistory.at(-1)?.purpose).toBe(
      "timeout.triggerCardSelection",
    );
  });
  it("offers Shield Breaker as an optional public dismantle selection and passes on timeout", () => {
    let state = started();
    state = equip(state, "talent.shield_breaker", "talent:1");
    state = equip(state, "talent.blood_box", "talent:2");
    state = equip(state, "armor.a01", "armor:2");
    state.players[1]!.hp = 2;
    const opened = processEventTriggers(
        state,
        ruleset,
        {
          eventType: "shield.broken",
          payload: {
            targetSeat: 1,
            sourceSeat: 2,
            attackId: "attack:test",
            segmentId: "segment:test",
          },
        },
        900,
        "shield-break:1",
      ),
      window = opened.state.pendingWindows[0]!;
    expect(opened.stoppedReason).toBe("specializedSelection");
    expect(window).toMatchObject({
      kind: "triggerCardSelection",
      prioritySeat: 1,
      mandatory: false,
      timeoutPolicy: "pass",
    });
    const passSession = new TriggerCardSelectionSession(opened.state, ruleset);
    expect(passSession.handleTimeout("shield-pass").accepted).toBe(true);
    expect(passSession.state.zones["armor:2"]!.orderedCardRefs).toHaveLength(1);
    const selectedSession = new TriggerCardSelectionSession(
        opened.state,
        ruleset,
      ),
      selected = selectedSession.handle({
        commandId: "shield-select",
        gameId: state.gameId,
        expectedStateRevision: opened.state.stateRevision,
        actorUserId: "u1",
        promptId: window.promptId,
        offerId: window.legalOfferIds.find(
          (offer) => offer !== "offer:trigger-card:pass",
        )!,
      });
    expect(selected.accepted).toBe(true);
    expect(
      selectedSession.state.zones["armor:2"]!.orderedCardRefs,
    ).toHaveLength(0);
    expect(
      selected.accepted && selected.events.map((event) => event.eventType),
    ).toEqual(expect.arrayContaining(["card.dismantled", "trigger.resolved"]));
    if (!selected.accepted) throw new Error("selection unexpectedly rejected");
    const continued = processCommittedEventTriggers(
      {
        previousRevision: selected.previousRevision,
        state: selectedSession.state,
        events: selected.events,
      },
      ruleset,
      950,
    );
    expect(continued.state.players[1]!.hp).toBe(4);
    expect(continued.events.map((event) => event.eventType)).toContain(
      "health.recovered",
    );
  });
});
