// @vitest-environment jsdom
import {mount} from "@vue/test-utils";
import {beforeAll,describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import GameView from "../views/GameView.vue";

beforeAll(()=>{
  const css=readFileSync(join(process.cwd(),"src","styles","base.css"),"utf8");
  const style=document.createElement("style");
  style.textContent=css;
  document.head.appendChild(style);
});

const emptyPlayer={seat:1 as const,team:"A" as const,nickname:"玩家1",connected:true,characterId:"character.knight",lifeState:"inPlay" as const,hp:5,maxHp:5,shield:5,maxShield:5,ironShield:0,handCount:0,handLimit:4,equipment:[],equipmentSlots:{weapon1:null,weapon2:null,weapon3:null,thirdWeapon:null,armor:null,mountOffense:null,mountDefense:null,talents:[],boss:null,tripleWield:false,mountOccupied:[],mountDual:false},judgmentZone:[],statuses:[]};
function snapshotWith(){return{type:"GAME_SNAPSHOT" as const,gameId:"g",rulesetVersion:"1.3.4" as const,stateRevision:1,lastEventSeq:1,serverTime:Date.now(),viewer:{userId:"u1",seat:1 as const,team:"A" as const},publicView:{round:1,activeSeat:1 as const,phase:"play" as const,players:[emptyPlayer,{...emptyPlayer,seat:2 as const}],drawPileCount:10,discardTop:[],centralCards:[],headline:undefined,winnerTeam:null},privateView:{hand:[],preselectedWeaponSlot:null,preselectedModeId:null,preselectableWeaponSlots:[],concealedChoices:[]},interaction:{prompt:null,offers:[],disabledHints:[]},chat:[]} as any;}
function mountView(snapshot:any,canDisbandRoom=false){return mount(GameView,{props:{snapshot,events:[],canDisbandRoom},global:{stubs:{GamePlayerPanel:true,PromptBanner:true,ResourceImage:true,GameEventFeed:true,GameChatPanel:true,CardDetailDrawer:true,CharacterDetailDrawer:true}}});}

describe("GameView 离局/解散确认窗口",()=>{
 it("点击退出本局先弹确认/取消窗口，确认后才 emit forfeit，取消不 emit",async()=>{
  const wrapper=mountView(snapshotWith());
  expect(wrapper.emitted("forfeit")).toBeUndefined();
  await wrapper.find(".forfeit-button").trigger("click");
  expect(wrapper.find(".confirm-dialog").exists()).toBe(true);
  expect(wrapper.text()).toContain("淘汰");
  await wrapper.find(".confirm-dialog__actions .button--danger").trigger("click");
  expect(wrapper.emitted("forfeit")).toBeTruthy();
 });
 it("取消按钮关闭窗口且不 emit forfeit",async()=>{
  const wrapper=mountView(snapshotWith());
  await wrapper.find(".forfeit-button").trigger("click");
  const cancel=wrapper.find(".confirm-dialog__actions .button");
  expect(cancel.exists()).toBe(true);
  await cancel.trigger("click");
  expect(wrapper.find(".confirm-dialog").exists()).toBe(false);
  expect(wrapper.emitted("forfeit")).toBeUndefined();
 });
 it("房主解散房间按钮仅对 canDisbandRoom 显示，确认后 emit disband",async()=>{
  const nonHost=mountView(snapshotWith(),false);
  expect(nonHost.find(".game-hud__actions .button--danger").exists()).toBe(false);
  const host=mountView(snapshotWith(),true);
  const button=host.find(".game-hud__actions .button--danger");
  expect(button.exists()).toBe(true);
  expect(host.text()).toContain("解散房间");
  await button.trigger("click");
  expect(host.find(".confirm-dialog").exists()).toBe(true);
  await host.find(".confirm-dialog__actions .button--danger").trigger("click");
  expect(host.emitted("disband")).toBeTruthy();
 });
});
