// @vitest-environment jsdom
import {createPinia,setActivePinia} from "pinia";
import {flushPromises,mount} from "@vue/test-utils";
import {beforeEach,describe,expect,it,vi} from "vitest";
import App from "./App.vue";
import {useServerProjectionStore} from "./stores/serverProjection";

const storage=()=>{const map=new Map<string,string>();return{getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v)},removeItem:(k:string)=>{map.delete(k)}};};
let session:ReturnType<typeof storage>;
beforeEach(()=>{session=storage();Object.defineProperty(window,"sessionStorage",{value:session,configurable:true});setActivePinia(createPinia());});
const stubs={ConnectionStatus:true,GameCard:true,ResourceImage:true,SeatCard:true,GameEventFeed:true};

const roomSnap=(phase:string)=>({type:"ROOM_SNAPSHOT",roomId:"r",roomCode:"ABCDEF",roomRevision:1,serverTime:1,phase,settings:{roomName:"房间",allowGuests:true,allowSpectators:true,turnTimeSeconds:60,responseTimeSeconds:30,reserveTimeSeconds:30,rulesetVersion:"1.3.4",dismantleBossEnabled:true},players:[],viewerUserId:"u",viewerSeat:1,permissions:{canChangeSeat:false,canUpdateSettings:false,canKick:false,canTransferHost:false,canStartGame:false,canCloseRoom:false},characterSelection:null,chat:[]} as never);
const setupSnap={type:"SETUP_SNAPSHOT",gameId:"g",rulesetVersion:"1.3.4",stateRevision:0,lastEventSeq:0,serverTime:1,lifecycle:"setupRedraw",viewer:{userId:"u",seat:1 as const,team:"A" as const},firstSeat:1 as const,drawPileCount:60,discardPile:[],seats:[],hand:[],redrawUsed:false,interaction:{prompt:null,offers:[],disabledHints:[]}} as never;

describe("App view switching",()=>{
 it("shows the setup redraw view after entering the game instead of the room view",async()=>{vi.stubGlobal("fetch",vi.fn());const store=useServerProjectionStore();store.acceptRoomMessage(roomSnap("inGame"));store.acceptGameMessage(setupSnap);const wrapper=mount(App,{global:{stubs}});await flushPromises();expect(wrapper.find(".setup-redraw").exists()).toBe(true);expect(wrapper.find(".room-summary").exists()).toBe(false);});
 it("shows the room view while waiting and before the game starts",async()=>{vi.stubGlobal("fetch",vi.fn());const store=useServerProjectionStore();store.acceptRoomMessage(roomSnap("waiting"));const wrapper=mount(App,{global:{stubs}});await flushPromises();expect(wrapper.find(".room-summary").exists()).toBe(true);expect(wrapper.find(".setup-redraw").exists()).toBe(false);});
});
