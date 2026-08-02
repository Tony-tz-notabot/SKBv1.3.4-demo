import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import { handCards } from "./state.js";

let ruleset: LoadedRuleset;
const users = { 1: "u1", 2: "u2", 3: "u3", 4: "u4" } as const;
const characters={1:"character.knight",2:"character.alchemist",3:"character.ranger",4:"character.wizard"} as const;
beforeAll(async () => { ruleset = await loadFrozenRuleset(resolve(import.meta.dirname, "../../../rulesets/v1.3.4")); });

describe("initial setup and redraw", () => {
  it("creates 337 deterministic instances and deals configured hands", () => {
    const first = createInitialSetup(ruleset, { gameId: "g1", firstSeat: 2, seed: 12345, usersBySeat: users,characterIdsBySeat:characters });
    const second = createInitialSetup(ruleset, { gameId: "g1", firstSeat: 2, seed: 12345, usersBySeat: users,characterIdsBySeat:characters });
    expect(Object.keys(first.cards)).toHaveLength(337);
    expect(first.zones.drawPile?.orderedCardRefs).toHaveLength(321);
    expect(([1,2,3,4] as const).map((seat) => handCards(first,seat).length)).toEqual([4, 4, 4, 4]);
    expect(first.randomHistory[0]?.resultRefs).toEqual(second.randomHistory[0]?.resultRefs);
    expect(first.players[0]).toMatchObject({characterId:"character.knight",hp:6,maxHp:6,shield:5,maxShield:5,initialTalentIds:["talent.blue_shield"],skillIds:["skill.knight.instinct"]});
  });

  it("discards all four and draws four without returning old cards", () => {
    const state = createInitialSetup(ruleset, { gameId: "g2", firstSeat: 1, seed: 9, usersBySeat: users,characterIdsBySeat:characters });
    const oldHand = [...handCards(state,1)];
    const result = resolveInitialRedraw(state, 1, true, ruleset);
    expect(handCards(result.state,1)).toHaveLength(4);
    expect(result.state.zones.discardPile?.orderedCardRefs).toEqual(oldHand);
    expect(handCards(result.state,1).some((ref) => oldHand.includes(ref))).toBe(false);
    expect(result.state.setup?.redrawBySeat[1]).toEqual({ decided: true, used: true });
    expect(result.state.history.domainEvents).toEqual(result.events);
    expect(state.zones.discardPile?.orderedCardRefs).toHaveLength(0);
  });

  it("starts only after all four decisions and rejects reuse", () => {
    let state = createInitialSetup(ruleset, { gameId: "g3", firstSeat: 3, seed: 88, usersBySeat: users,characterIdsBySeat:characters });
    for (const seat of [1, 2, 3] as const) state = resolveInitialRedraw(state, seat, false, ruleset).state;
    expect(state.lifecycle).toBe("setupRedraw");
    const final = resolveInitialRedraw(state, 4, false, ruleset);
    expect(final.state.lifecycle).toBe("inProgress");
    expect(final.state).toMatchObject({round:1,activeSeat:3,phase:"prepare"});
    expect(final.events.map(event=>event.eventType)).toContain("game.start");
    expect(() => resolveInitialRedraw(final.state, 4, false, ruleset)).toThrow("REDRAW_WINDOW_CLOSED");
  });

  it("initializes Punching Bag's special extra-health layer from character data",()=>{const selected={...characters,2:"character.punching_bag"} as const,state=createInitialSetup(ruleset,{gameId:"punching-bag",firstSeat:1,seed:9,usersBySeat:users,characterIdsBySeat:selected});expect(state.players[1]).toMatchObject({characterId:"character.punching_bag",markers:{"punchingBag.extraHp":12}});});
  it("initializes the global health floor and Traveler's special initial floor",()=>{const selected={...characters,2:"character.interdimensional_traveler"} as const,state=createInitialSetup(ruleset,{gameId:"health-floor",firstSeat:1,seed:9,usersBySeat:users,characterIdsBySeat:selected});expect(state.players[0]!.markers.healthFloor).toBe(-1);expect(state.players[1]!.markers.healthFloor).toBe(3);});
});
