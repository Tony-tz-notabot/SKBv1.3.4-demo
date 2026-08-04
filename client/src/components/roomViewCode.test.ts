// @vitest-environment jsdom
import {mount} from "@vue/test-utils";
import {afterEach,describe,expect,it,vi} from "vitest";
import RoomView from "../views/RoomView.vue";

function roomSnap(){return{type:"ROOM_SNAPSHOT",roomId:"r",roomCode:"ABCDEF",roomRevision:1,serverTime:1,phase:"waiting",settings:{roomName:"测试房",allowGuests:true,allowSpectators:true,turnTimeSeconds:120,responseTimeSeconds:120,reserveTimeSeconds:30,rulesetVersion:"1.3.4",dismantleBossEnabled:true},players:[],viewerUserId:"u",viewerSeat:1,permissions:{canChangeSeat:false,canUpdateSettings:false,canKick:false,canTransferHost:false,canStartGame:false,canCloseRoom:false},characterSelection:null,chat:[]} as never;}
const stubs={SeatCard:true,ChatPanel:true};
afterEach(()=>{vi.restoreAllMocks();});

describe("RoomView 房间号",()=>{
 it("shows the room code prominently with a copy button that writes to the clipboard",async()=>{
  const writeText=vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator,"clipboard",{value:{writeText},configurable:true});
  const wrapper=mount(RoomView,{props:{snapshot:roomSnap()},global:{stubs}});
  const code=wrapper.find(".room-code");
  expect(code.exists()).toBe(true);
  expect(code.text()).toContain("ABCDEF");
  const copy=wrapper.find(".room-code__copy");
  expect(copy.exists()).toBe(true);
  await copy.trigger("click");
  expect(writeText).toHaveBeenCalledWith("ABCDEF");
  expect(wrapper.find(".room-code__copied").exists()).toBe(true);
  expect(wrapper.find(".room-code__copied").text()).toContain("已复制");
 });
 it("keeps the room code visible even while waiting for other players",()=>{
  const wrapper=mount(RoomView,{props:{snapshot:roomSnap()},global:{stubs}});
  expect(wrapper.find(".room-code").text()).toContain("ABCDEF");
  expect(wrapper.find(".room-summary").exists()).toBe(true);
 });
});
