import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { commitAttack } from "./attack.js";
import { runCombatUntilBlocked } from "./combatScheduler.js";
import { finalizeJudgment } from "./judgment.js";
import { setWeaponPreselection } from "./preselection.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";
let r: LoadedRuleset;
beforeAll(async () => {
  r = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});
function move(s: AuthoritativeGameState, ref: string, to: string) {
  const c = s.cards[ref]!,
    z = s.zones[c.zoneRef]!;
  z.orderedCardRefs.splice(z.orderedCardRefs.indexOf(ref), 1);
  s.zones[to]!.orderedCardRefs.push(ref);
  Object.assign(c, {
    zoneRef: to,
    ownerSeat: s.zones[to]!.ownerSeat,
    controllerSeat: s.zones[to]!.ownerSeat,
    faceUp: !to.startsWith("hand:"),
  });
}
describe("precision strike", () => {
  it("judges per weapon target before response and red makes critical while suppressing only hand dodge", () => {
    let s = createInitialSetup(r, {
      gameId: "precision",
      firstSeat: 1,
      seed: 3801,
      usersBySeat: { 1: "u1", 2: "u2", 3: "u3", 4: "u4" },
      characterIdsBySeat: {
        1: "character.knight",
        2: "character.ranger",
        3: "character.wizard",
        4: "character.druid",
      },
    });
    for (const n of [1, 2, 3, 4] as const)
      s = resolveInitialRedraw(s, n, false, r).state;
    Object.assign(s, {
      activeSeat: 1,
      phase: "play",
      phaseBoundary: "body",
      phaseMode: "manual",
      phaseBodyResolved: false,
    });
    s.players[0]!.limits.attackCountRemaining = 1;
    s.players[0]!.initialTalentIds.push("talent.precision_strike");
    const weapon = Object.values(s.cards).find(
        (x) => x.templateId === "weapon.w01",
      )!,
      kill = Object.values(s.cards).find((x) =>
        x.templateId.startsWith("basic.kill."),
      )!,
      dodge = Object.values(s.cards).find((x) =>
        x.templateId.startsWith("basic.dodge."),
      )!,
      block = Object.values(s.cards).find(
        (x) => x.templateId === "weapon.w34",
      )!;
    move(s, weapon.cardRef, "weapon:1:1");
    move(s, kill.cardRef, "hand:1");
    move(s, dodge.cardRef, "hand:2");
    move(s, block.cardRef, "weapon:1:2");
    s = setWeaponPreselection(s, 1, "weapon:1:1", null, r).state;
    s = commitAttack(s, r, {
      attackerSeat: 1,
      targetRefs: ["character:2"],
      killCardRefs: [kill.cardRef],
    }).state;
    let run = runCombatUntilBlocked(s, r, () => 900);
    expect(run.stoppedReason).toBe("judgment");
    s = finalizeJudgment(run.state, "red").state;
    run = runCombatUntilBlocked(s, r, () => 900);
    expect(run.stoppedReason).toBe("responseWindow");
    expect(run.state.combat.attack).toMatchObject({
      critical: true,
      cannotHandDodge: true,
    });
    expect(
      run.state.pendingWindows[0]!.legalOfferIds.some((x) =>
        x.includes(":dodge:"),
      ),
    ).toBe(false);
  });
});
