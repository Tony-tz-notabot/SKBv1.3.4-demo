import {resolve} from "node:path";
import {beforeAll,describe,expect,it} from "vitest";
import {loadFrozenRuleset} from "../ruleset/loadRuleset.js";
import type {LoadedRuleset} from "../ruleset/types.js";
import {drawCards} from "./deck.js";
import {createInitialSetup,resolveInitialRedraw} from "./setup.js";
import {handCards,type AuthoritativeGameState} from "./state.js";

let ruleset:LoadedRuleset;
const users={1:"u1",2:"u2",3:"u3",4:"u4"} as const,characters={1:"character.knight",2:"character.alchemist",3:"character.ranger",4:"character.wizard"} as const;
beforeAll(async()=>{ruleset=await loadFrozenRuleset(resolve(import.meta.dirname,"../../../rulesets/v1.3.4"));});
function setupWithDiscard():AuthoritativeGameState{let state=createInitialSetup(ruleset,{gameId:"deck",firstSeat:1,seed:17,usersBySeat:users,characterIdsBySeat:characters});return resolveInitialRedraw(state,1,true,ruleset).state;}
function leaveOneInDrawPile(state:AuthoritativeGameState):void{const moved=state.zones.drawPile!.orderedCardRefs.splice(1);state.zones.outsideDeck!.orderedCardRefs.push(...moved);for(const ref of moved){state.cards[ref]!.zoneRef="outsideDeck";state.cards[ref]!.ownerSeat=null;state.cards[ref]!.controllerSeat=null;}}

describe("deck draw and reshuffle",()=>{
  it("continues one draw across a deterministic discard reshuffle",()=>{const state=setupWithDiscard(),originalTop=state.zones.drawPile!.orderedCardRefs[0]!;leaveOneInDrawPile(state);const before=handCards(state,1).length,result=drawCards(state,1,2,"test.cross-boundary");expect(handCards(result.state,1)).toHaveLength(before+2);expect(handCards(result.state,1).slice(-2)[0]).toBe(originalTop);expect(result.state.zones.discardPile!.orderedCardRefs).toHaveLength(0);expect(result.events.map(event=>event.eventType)).toContain("deck.reshuffled");expect(result.state.randomHistory.at(-1)?.purpose).toBe("deck.reshuffle");expect(state.zones.discardPile!.orderedCardRefs).toHaveLength(4);});
  it("returns fewer cards when both piles are exhausted",()=>{const state=setupWithDiscard();state.zones.discardPile!.orderedCardRefs.splice(0).forEach(ref=>{state.zones.outsideDeck!.orderedCardRefs.push(ref);state.cards[ref]!.zoneRef="outsideDeck";});state.zones.drawPile!.orderedCardRefs.splice(0).forEach(ref=>{state.zones.outsideDeck!.orderedCardRefs.push(ref);state.cards[ref]!.zoneRef="outsideDeck";});const result=drawCards(state,1,2,"test.empty");expect(result.events.at(-1)?.payload).toMatchObject({requestedCount:2,actualCount:0});});
  it("replays the same reshuffle from the same state",()=>{const state=setupWithDiscard();leaveOneInDrawPile(state);const a=drawCards(state,1,3,"test.replay").state,b=drawCards(structuredClone(state),1,3,"test.replay").state;expect(handCards(a,1).slice(-3)).toEqual(handCards(b,1).slice(-3));expect(a.randomHistory).toEqual(b.randomHistory);});
});
