import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import {
  compileTriggerRegistry,
  matchTriggeredEffects,
  type CompiledTriggerDefinition,
} from "./triggerRegistry.js";

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
    gameId: "triggers",
    firstSeat: 1,
    seed: 101,
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
    )!,
    from = state.zones[card.zoneRef]!;
  from.orderedCardRefs.splice(from.orderedCardRefs.indexOf(card.cardRef), 1);
  state.zones[zoneRef]!.orderedCardRefs.push(card.cardRef);
  card.zoneRef = zoneRef;
  card.ownerSeat = state.zones[zoneRef]!.ownerSeat;
  card.controllerSeat = state.zones[zoneRef]!.ownerSeat;
  card.faceUp = true;
  return card;
}
const definition = (
  triggerId: string,
  familyId: string,
  priority: number,
  filter: CompiledTriggerDefinition["filter"] = {},
): CompiledTriggerDefinition => ({
  triggerId,
  sourceFile: "test.json",
  sourcePath: triggerId,
  familyId,
  eventType: "test.event",
  mandatory: priority >= 700,
  optional: priority === 600,
  timing: null,
  scope: null,
  priorityName:
    priority >= 900
      ? "replacement"
      : priority >= 700
        ? "mandatoryModifier"
        : priority >= 600
          ? "optionalModifier"
          : "ordinaryTrigger",
  priority,
  filter,
  costs: [],
  effects: [],
});

describe("trigger registry", () => {
  it("compiles every concrete frozen trigger with stable unique provenance", () => {
    const registry = compileTriggerRegistry(ruleset);
    expect(registry).toHaveLength(26);
    expect(new Set(registry.map((item) => item.triggerId)).size).toBe(26);
    expect(registry.map((item) => item.sourceFile)).toEqual(
      expect.arrayContaining(["boss-rules.json", "nonboss-rules.json"]),
    );
    expect(
      registry.find((item) => item.triggerId === "purpleLord.demonBlade"),
    ).toMatchObject({
      familyId: "boss.purple_lord",
      eventType: "phase.before",
      mandatory: true,
    });
  });
  it("matches an active boss instance and its supported phase filter", () => {
    const state = started(),
      boss = equip(state, "boss.purple_lord", "boss:1");
    boss.runtime.active = true;
    const matches = matchTriggeredEffects(
      state,
      compileTriggerRegistry(ruleset),
      {
        eventType: "phase.before",
        payload: { phase: "prepare", actorSeat: 2 },
      },
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      triggerId: "purpleLord.demonBlade",
      controllerSeat: 1,
      sourceRef: boss.cardRef,
      unsupportedFilterKeys: [],
    });
  });
  it("orders by system priority then counterclockwise seat order", () => {
    const state = started();
    state.activeSeat = 3;
    for (const player of state.players)
      player.initialTalentIds.push("talent.test");
    const registry = [
      definition("ordinary", "talent.test", 500),
      definition("replacement", "talent.test", 900),
    ];
    const matches = matchTriggeredEffects(state, registry, {
      eventType: "test.event",
      payload: {},
    });
    expect(matches.slice(0, 4).map((item) => item.triggerId)).toEqual([
      "replacement",
      "replacement",
      "replacement",
      "replacement",
    ]);
    expect(matches.slice(0, 4).map((item) => item.controllerSeat)).toEqual([
      3, 4, 1, 2,
    ]);
  });
  it("marks same-controller same-priority triggers for player ordering", () => {
    const state = started();
    state.players[0]!.initialTalentIds.push("talent.test");
    const matches = matchTriggeredEffects(
      state,
      [
        definition("a", "talent.test", 700),
        definition("b", "talent.test", 700),
      ],
      { eventType: "test.event", payload: {} },
    );
    expect(matches).toHaveLength(2);
    expect(matches.every((item) => item.requiresControllerOrdering)).toBe(true);
  });
  it("fails closed when a filter key has no implemented semantics", () => {
    const state = started();
    state.players[0]!.initialTalentIds.push("talent.test");
    expect(
      matchTriggeredEffects(
        state,
        [definition("unknown", "talent.test", 700, { notYetSupported: true })],
        { eventType: "test.event", payload: {} },
      ),
    ).toHaveLength(0);
  });
  it("does not activate equipped triggers while that equipment is disabled", () => {
    const state = started(),
      armor = equip(state, "armor.a02", "armor:1");
    state.players[0]!.markers.equipmentEffectsDisabled = true;
    const custom = definition("armor", "armor.a02", 700);
    expect(
      matchTriggeredEffects(state, [custom], {
        eventType: "test.event",
        payload: {},
      }),
    ).toHaveLength(0);
    state.players[0]!.markers.equipmentEffectsDisabled = false;
    expect(
      matchTriggeredEffects(state, [custom], {
        eventType: "test.event",
        payload: {},
      })[0],
    ).toMatchObject({ sourceRef: armor.cardRef, controllerSeat: 1 });
  });
  it("matches a card's own lost trigger from the former-zone snapshot after it leaves play", () => {
    const state = started(),
      bloodBox = equip(state, "talent.blood_box", "talent:1"),
      registry = [
        {
          ...definition("self-lost", "talent.blood_box", 700, {
            cardIsThisTalent: true,
          }),
          eventType: "card.lost",
        },
      ];
    state.zones["talent:1"]!.orderedCardRefs = [];
    state.zones.discardPile!.orderedCardRefs.push(bloodBox.cardRef);
    bloodBox.zoneRef = "discardPile";
    bloodBox.ownerSeat = null;
    bloodBox.controllerSeat = null;
    const matches = matchTriggeredEffects(state, registry, {
      eventType: "card.lost",
      payload: {
        cardRef: bloodBox.cardRef,
        lostFamilyId: "talent.blood_box",
        ownerSeat: 1,
        fromZoneRef: "talent:1",
      },
    });
    expect(matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          familyId: "talent.blood_box",
          sourceRef: bloodBox.cardRef,
          controllerSeat: 1,
        }),
      ]),
    );
  });
  it("matches Triple Wield cleanup only while regular weapons exceed base capacity", () => {
    const state = started(),
      talent = equip(state, "talent.triple_wield", "talent:1"),
      weapons = Object.values(state.cards)
        .filter((card) => card.templateId.startsWith("weapon."))
        .slice(0, 3);
    weapons.forEach((weapon, index) =>
      equip(state, weapon.templateId, `weapon:${index + 1}:1`),
    );
    state.zones["talent:1"]!.orderedCardRefs = [];
    state.zones.discardPile!.orderedCardRefs.push(talent.cardRef);
    talent.zoneRef = "discardPile";
    talent.ownerSeat = null;
    talent.controllerSeat = null;
    const event = {
      eventType: "card.lost",
      payload: {
        cardRef: talent.cardRef,
        lostFamilyId: "talent.triple_wield",
        ownerSeat: 1,
        fromZoneRef: "talent:1",
      },
    } as const;
    expect(
      matchTriggeredEffects(state, compileTriggerRegistry(ruleset), event)[0],
    ).toMatchObject({
      familyId: "talent.triple_wield",
      controllerSeat: 1,
      unsupportedFilterKeys: [],
    });
    state.zones["weapon:3:1"]!.orderedCardRefs.pop();
    expect(
      matchTriggeredEffects(state, compileTriggerRegistry(ruleset), event),
    ).toHaveLength(0);
  });
  it("matches Shield Breaker only for a damage-caused break with a dismantlable source card", () => {
    const state = started();
    equip(state, "talent.shield_breaker", "talent:1");
    equip(state, "armor.a01", "armor:2");
    const event = {
      eventType: "shield.broken",
      payload: {
        targetSeat: 1,
        sourceSeat: 2,
        attackId: "attack:test",
        segmentId: "segment:test",
      },
    } as const;
    expect(
      matchTriggeredEffects(state, compileTriggerRegistry(ruleset), event)[0],
    ).toMatchObject({
      familyId: "talent.shield_breaker",
      controllerSeat: 1,
      unsupportedFilterKeys: [],
    });
    state.zones["armor:2"]!.orderedCardRefs = [];
    expect(
      matchTriggeredEffects(state, compileTriggerRegistry(ruleset), event),
    ).toHaveLength(0);
  });
});
