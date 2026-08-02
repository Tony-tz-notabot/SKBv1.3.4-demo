import {resolve} from "node:path";
import {beforeAll,describe,expect,it} from "vitest";
import {loadFrozenRuleset} from "../ruleset/loadRuleset.js";
import type {LoadedRuleset} from "../ruleset/types.js";
import {createInitialSetup} from "./setup.js";
import {validateAuthoritativeState} from "./stateValidation.js";

let ruleset:LoadedRuleset;const users={1:"u1",2:"u2",3:"u3",4:"u4"} as const;
const characters={1:"character.knight",2:"character.alchemist",3:"character.ranger",4:"character.wizard"} as const;
beforeAll(async()=>{ruleset=await loadFrozenRuleset(resolve(import.meta.dirname,"../../../rulesets/v1.3.4"));});
describe("authoritative state invariants",()=>{
  it("accepts the normalized initial state",()=>{expect(validateAuthoritativeState(createInitialSetup(ruleset,{gameId:"g",firstSeat:1,seed:1,usersBySeat:users,characterIdsBySeat:characters})).kind).toBe("AUTHORITATIVE_GAME_STATE");});
  it("rejects a card present in two zones",()=>{const state=createInitialSetup(ruleset,{gameId:"g",firstSeat:1,seed:1,usersBySeat:users,characterIdsBySeat:characters});state.zones.discardPile!.orderedCardRefs.push(state.zones.drawPile!.orderedCardRefs[0]!);expect(()=>validateAuthoritativeState(state)).toThrow("STATE_CARD_IN_MULTIPLE_ZONES");});
  it("rejects a decided redraw with a live window",()=>{const state=createInitialSetup(ruleset,{gameId:"g",firstSeat:1,seed:1,usersBySeat:users,characterIdsBySeat:characters});state.setup!.redrawBySeat[1].decided=true;expect(()=>validateAuthoritativeState(state)).toThrow("STATE_REDRAW_WINDOW_MISMATCH");});
  it("allows missing bars only after death",()=>{const state=createInitialSetup(ruleset,{gameId:"g",firstSeat:1,seed:1,usersBySeat:users,characterIdsBySeat:characters});state.players[0]!.lifeState="deadNotEliminated";state.players[0]!.hp=null;state.players[0]!.shield=null;expect(()=>validateAuthoritativeState(state)).not.toThrow();state.players[0]!.lifeState="eliminated";expect(()=>validateAuthoritativeState(state)).not.toThrow();state.players[0]!.lifeState="alive";expect(()=>validateAuthoritativeState(state)).toThrow("STATE_LIVING_BARS_MISSING");});
  it("rejects a status whose duration is missing",()=>{const state=createInitialSetup(ruleset,{gameId:"g",firstSeat:1,seed:1,usersBySeat:users,characterIdsBySeat:characters});state.players[0]!.statuses.push({statusRef:"s",statusId:"status.frozen",ownerSeat:1,sourceRef:null,stackPolicy:"uniqueRefresh",stacks:1,priority:0,durationId:"missing",skipPhases:["play"],metadata:{}});expect(()=>validateAuthoritativeState(state)).toThrow("STATE_STATUS_DURATION_MISSING");});
});
