import {resolve} from "node:path";
import {beforeAll,describe,expect,it} from "vitest";
import {loadFrozenRuleset} from "../ruleset/loadRuleset.js";
import type {LoadedRuleset} from "../ruleset/types.js";
import {calculateHandLimit,requiredDiscardCount} from "./handLimit.js";
import {resolvePhaseBody} from "./phaseBody.js";
import {createInitialSetup,resolveInitialRedraw} from "./setup.js";

let ruleset:LoadedRuleset;const users={1:"u1",2:"u2",3:"u3",4:"u4"} as const,characters={1:"character.knight",2:"character.alchemist",3:"character.ranger",4:"character.wizard"} as const;
beforeAll(async()=>{ruleset=await loadFrozenRuleset(resolve(import.meta.dirname,"../../../rulesets/v1.3.4"));});
function started(){let state=createInitialSetup(ruleset,{gameId:"limit",firstSeat:1,seed:9,usersBySeat:users,characterIdsBySeat:characters});for(const seat of [1,2,3,4] as const)state=resolveInitialRedraw(state,seat,false,ruleset).state;return state;}

describe("hand limit and discard offer",()=>{
  it("uses max(0,min(4,hp)+modifier)",()=>{const state=started(),player=state.players[0]!;player.hp=2;player.limits.handLimitModifier=1;expect(calculateHandLimit(state,1)).toBe(3);player.limits.handLimitModifier=-8;expect(calculateHandLimit(state,1)).toBe(0);player.hp=null;player.limits.handLimitModifier=2;expect(calculateHandLimit(state,1)).toBe(2);});
  it("opens an exact mandatory discard offer",()=>{const state=started();state.phase="discard";state.phaseMode="manual";state.phaseBoundary="body";state.phaseBodyResolved=false;state.players[0]!.hp=2;expect(requiredDiscardCount(state,1)).toBe(2);const result=resolvePhaseBody(state,ruleset,500).state;expect(result.pendingWindows[0]).toMatchObject({kind:"discardPhaseAction",mandatory:true,context:{requiredCount:2}});expect((result.pendingWindows[0]!.context!.legalCardRefs as string[])).toHaveLength(4);});
  it("auto-resolves discard when the hand is within the limit",()=>{const state=started();state.phase="discard";state.phaseMode="manual";state.phaseBoundary="body";state.phaseBodyResolved=false;const refs=state.zones["hand:1"]!.orderedCardRefs.splice(0);state.zones.outsideDeck!.orderedCardRefs.push(...refs);for(const ref of refs)state.cards[ref]!.zoneRef="outsideDeck";const result=resolvePhaseBody(state,ruleset,500).state;expect(result.phaseBodyResolved).toBe(true);expect(result.pendingWindows).toHaveLength(0);});
});
