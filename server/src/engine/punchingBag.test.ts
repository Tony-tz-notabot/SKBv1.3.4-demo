import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import { EngineTransaction } from "./transaction.js";
import { applyDirectDamageInTransaction } from "./damage.js";
import { advanceTimeline } from "./timeline.js";
import { queuePunchingBagInertiaAtSourceEnd } from "./punchingBag.js";
let ruleset: LoadedRuleset;
beforeAll(async () => {
  ruleset = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});
function ready() {
  let s = createInitialSetup(ruleset, {
    gameId: "inertia",
    firstSeat: 1,
    seed: 367,
    usersBySeat: { 1: "u1", 2: "u2", 3: "u3", 4: "u4" },
    characterIdsBySeat: {
      1: "character.knight",
      2: "character.punching_bag",
      3: "character.ranger",
      4: "character.wizard",
    },
  });
  for (const seat of [1, 2, 3, 4] as const)
    s = resolveInitialRedraw(s, seat, false, ruleset).state;
  return s;
}
describe("Punching Bag inertia", () => {
  it("counts actual extra-health, shield, and hp loss by source and emits one true damage per three", () => {
    let s = ready();
    const tx = new EngineTransaction(s),
      bag = tx.draft.players[1]!;
    applyDirectDamageInTransaction(tx, {
      damageId: "extra",
      sourceSeat: 1,
      targetRef: "character:2",
      amount: 2,
      damageType: "normal",
      element: "none",
      isAdditional: false,
      ruleset,
    });
    bag.markers["punchingBag.extraHp"] = 0;
    bag.shield = 2;
    applyDirectDamageInTransaction(tx, {
      damageId: "shield",
      sourceSeat: 1,
      targetRef: "character:2",
      amount: 2,
      damageType: "normal",
      element: "none",
      isAdditional: false,
      ruleset,
    });
    bag.shield = 0;
    applyDirectDamageInTransaction(tx, {
      damageId: "hp",
      sourceSeat: 1,
      targetRef: "character:2",
      amount: 2,
      damageType: "normal",
      element: "none",
      isAdditional: false,
      ruleset,
    });
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    s = committed.state;
    expect(s.players[1]!.markers["punchingBag.inertia.bySource"]).toMatchObject(
      { "1": 6 },
    );
    s.activeSeat = 1;
    s.phase = "discard";
    s.phaseMode = "manual";
    s.phaseBoundary = "body";
    s.phaseBodyResolved = true;
    s.pendingWindows = [];
    s = advanceTimeline(s, { kind: "normal" }, ruleset).state;
    expect(
      s.scheduledEffects.filter(
        (x) =>
          String((x.effect as Record<string, unknown>).damageType) === "true",
      ),
    ).toHaveLength(2);
    expect(s.players[1]!.markers["punchingBag.inertia.bySource"]).toMatchObject(
      { "1": 0 },
    );
  });
  it("retaliates against dead-not-eliminated sources but clears eliminated sources", () => {
    let s = ready();
    s.players[1]!.markers["punchingBag.inertia.bySource"] = { "1": 4 };
    s.players[0]!.lifeState = "deadNotEliminated";
    s.players[0]!.hp = null;
    s.players[0]!.shield = null;
    let tx = new EngineTransaction(s);
    queuePunchingBagInertiaAtSourceEnd(tx, ruleset, 1);
    expect(tx.draft.scheduledEffects).toHaveLength(1);
    expect(
      tx.draft.players[1]!.markers["punchingBag.inertia.bySource"],
    ).toMatchObject({ "1": 1 });
    s = ready();
    s.players[1]!.markers["punchingBag.inertia.bySource"] = { "1": 4 };
    s.players[0]!.lifeState = "eliminated";
    tx = new EngineTransaction(s);
    queuePunchingBagInertiaAtSourceEnd(tx, ruleset, 1);
    expect(tx.draft.scheduledEffects).toHaveLength(0);
    expect(
      tx.draft.players[1]!.markers["punchingBag.inertia.bySource"],
    ).toEqual({});
  });
});
