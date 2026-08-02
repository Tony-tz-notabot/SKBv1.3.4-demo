import {resolve} from "node:path";
import {beforeAll,describe,expect,it} from "vitest";
import {loadFrozenRuleset} from "../ruleset/loadRuleset.js";
import type {LoadedRuleset} from "../ruleset/types.js";
import {GameService} from "./gameService.js";

let ruleset:LoadedRuleset;
beforeAll(async()=>{ruleset=await loadFrozenRuleset(resolve(import.meta.dirname,"../../../rulesets/v1.3.4"));});
describe("idempotency capacity limits",()=>{
 it("caps persisted game command results at 5000",()=>{const service=new GameService(ruleset,()=>1000),room={game:{gameId:"g",stateRevision:0} as never,players:[{userId:"u1"} as never]};for(let i=0;i<5050;i+=1){const result=service.handle(room as never,{userId:"u1"} as never,{commandId:`bad-${i}`,gameId:"missing",expectedStateRevision:0,command:"EXECUTE_OFFER"} as never);expect(result.accepted).toBe(false);}const persisted=service.persistedResults()["__game"];expect(Object.keys(persisted).length).toBe(5000);});
 it("returns the same result for a replayed commandId",()=>{const service=new GameService(ruleset,()=>1000),room={game:{gameId:"g",stateRevision:0} as never,players:[{userId:"u1"} as never]};const command={commandId:"same",gameId:"missing",expectedStateRevision:0,command:"EXECUTE_OFFER"} as never;const first=service.handle(room as never,{userId:"u1"} as never,command);const second=service.handle(room as never,{userId:"u1"} as never,command);expect(second).toEqual(first);});
});
