import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import {
  DarkKnightActionSession,
  buildDarkKnightActionOffers,
  commitDarkKnightBlackSwordAttack,
  createDarkKnightBlackSword,
} from "./darkKnight.js";
import { runAutomaticScheduler } from "./automaticScheduler.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";

let ruleset: LoadedRuleset;
beforeAll(async () => {
  ruleset = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});

function ready() {
  let state = createInitialSetup(ruleset, {
    gameId: "dark-knight",
    firstSeat: 1,
    seed: 419,
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
  state.phase = "play";
  state.phaseBoundary = "body";
  state.phaseMode = "manual";
  state.pendingWindows = [
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
  const boss = Object.values(state.cards).find(
    (card) => card.templateId === "boss.dark_grand_knight",
  )!;
  const from = state.zones[boss.zoneRef]!;
  from.orderedCardRefs.splice(from.orderedCardRefs.indexOf(boss.cardRef), 1);
  state.zones["boss:1"]!.orderedCardRefs.push(boss.cardRef);
  boss.zoneRef = "boss:1";
  boss.ownerSeat = boss.controllerSeat = 1;
  boss.faceUp = true;
  boss.runtime.active = true;
  return state;
}

describe("Dark Grand Knight black swords", () => {
  it("modifies hp then max hp, creates a marker, and rejects a full rack without mutation", () => {
    const state = ready(),
      hp = state.players[0]!.hp!,
      maxHp = state.players[0]!.maxHp!,
      made = createDarkKnightBlackSword(state, ruleset, 1).state;
    expect(made.players[0]).toMatchObject({ hp: hp - 1, maxHp: maxHp - 1 });
    expect(made.players[0]!.markers["darkKnight.blackSword"]).toBe(1);
    const full = createDarkKnightBlackSword(made, ruleset, 1).state;
    const snapshot = structuredClone(full);
    expect(() => createDarkKnightBlackSword(full, ruleset, 1)).toThrow(
      "DARK_KNIGHT_BLACK_SWORD_FULL",
    );
    expect(full).toEqual(snapshot);
  });

  it("enters dying after both modifications while still granting the sword", () => {
    const state = ready();
    state.players[0]!.hp = 1;
    state.players[0]!.maxHp = 1;
    const made = createDarkKnightBlackSword(state, ruleset, 1).state;
    expect(made.players[0]).toMatchObject({
      hp: 0,
      maxHp: 0,
      lifeState: "dying",
      markers: { "darkKnight.blackSword": 1 },
    });
    expect(made.combat.dyingStack).toEqual(["character:1"]);
    expect(made.pendingWindows).toHaveLength(0);
    const scheduled = runAutomaticScheduler(made, ruleset, () => 950);
    expect(scheduled.state.pendingWindows[0]).toMatchObject({
      kind: "dyingRescue",
      deadlineAt: 950,
    });
  });

  it.each([
    ["thrust", ["ranged", "scatter"], 2, 2, true],
    ["slash", ["melee"], 4, 1, false],
    ["hammer", ["field"], 2, 1, false],
  ] as const)(
    "commits %s with its exact template while attack count is zero",
    (mode, types, amount, repeat, cannotBlock) => {
      const state = ready();
      state.players[0]!.markers["darkKnight.blackSword"] = 1;
      state.players[0]!.limits[ruleset.settings.combat.attackCountLimitId] = 0;
      const out = commitDarkKnightBlackSwordAttack(state, ruleset, {
        actorSeat: 1,
        targetSeat: 2,
        mode,
      }).state;
      expect(out.players[0]!.markers["darkKnight.blackSword"]).toBe(0);
      expect(
        out.players[0]!.limits[ruleset.settings.combat.attackCountLimitId],
      ).toBe(0);
      expect(out.combat.attack).toMatchObject({
        modeId: mode,
        attackTypes: types,
        ignoreArmor: true,
        damageSegments: [{ amount, repeat }],
        resumePlayDeadlineAt: 900,
        ...(cannotBlock ? { cannotMeleeBlock: true } : {}),
        ...(mode === "hammer" ? { onHitStatuses: ["status.electrified"] } : {}),
      });
    },
  );

  it("publishes revision-bound offers and handles a command idempotently", () => {
    const state = ready();
    state.players[0]!.markers["darkKnight.blackSword"] = 1;
    expect(
      buildDarkKnightActionOffers(state, ruleset, 1).map(
        (offer) => offer.offerId,
      ),
    ).toEqual([
      "offer:dark-knight:create-black-sword",
      "offer:dark-knight:attack:thrust",
      "offer:dark-knight:attack:slash",
      "offer:dark-knight:attack:hammer",
    ]);
    const session = new DarkKnightActionSession(state, ruleset),
      command = {
        commandId: "dark-action-1",
        gameId: state.gameId,
        expectedStateRevision: state.stateRevision,
        actorUserId: "u1",
        promptId: "play",
        offerId: "offer:dark-knight:attack:hammer",
        targetSeat: 2 as const,
      },
      first = session.handle(command),
      repeated = session.handle(command);
    expect(first.accepted).toBe(true);
    expect(repeated).toEqual(first);
    expect(session.state.players[0]!.markers["darkKnight.blackSword"]).toBe(0);
  });
});
