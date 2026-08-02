import {createPinia,setActivePinia} from "pinia";
import {beforeEach,describe,expect,it} from "vitest";
import {useServerProjectionStore} from "./serverProjection";

const event=(seq:number)=>({type:"PRESENTATION_EVENT" as const,eventSeq:seq,stateRevision:1,eventType:"ACTION_COMMITTED" as const,payload:{sourceRef:"public:seat_1",actionKind:"x"}});
const gameSnap=(lastEventSeq:number)=>({type:"GAME_SNAPSHOT" as const,gameId:"g",rulesetVersion:"1.3.4" as const,stateRevision:1,lastEventSeq,serverTime:Date.now(),viewer:{userId:"u",seat:1 as const,team:"A" as const},publicView:{} as never,privateView:{hand:[],preselectedWeaponSlot:null,preselectedModeId:null,preselectableWeaponSlots:[],concealedChoices:[]},interaction:{prompt:null,offers:[],disabledHints:[]},chat:[]});

describe("serverProjection event dedup",()=>{
 beforeEach(()=>setActivePinia(createPinia()));
 it("accepts monotonic events and drops duplicate eventSeq",()=>{
  const store=useServerProjectionStore();
  store.acceptGameMessage(gameSnap(0));
  store.acceptGameMessage(event(1));store.acceptGameMessage(event(2));store.acceptGameMessage(event(2));store.acceptGameMessage(event(3));
  expect(store.eventQueue.map(e=>e.eventSeq)).toEqual([1,2,3]);
 });
 it("resets the queue on a fresh snapshot and ignores stale events after reconnect",()=>{
  const store=useServerProjectionStore();
  store.acceptGameMessage(gameSnap(5));
  store.acceptGameMessage(event(6));store.acceptGameMessage(event(4));
  expect(store.eventQueue.map(e=>e.eventSeq)).toEqual([6]);
  store.acceptGameMessage(gameSnap(6));
  expect(store.eventQueue).toHaveLength(0);
  store.acceptGameMessage(event(7));store.acceptGameMessage(event(6));
  expect(store.eventQueue.map(e=>e.eventSeq)).toEqual([7]);
 });
});
