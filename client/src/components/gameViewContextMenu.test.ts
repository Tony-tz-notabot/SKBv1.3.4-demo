// @vitest-environment jsdom
import {mount} from "@vue/test-utils";
import {describe,expect,it} from "vitest";
import GameView from "../views/GameView.vue";

const equipmentCard={ref:"public:w1",templateId:"weapon.w01",displayName:"烈焰剑",category:"weapon" as const,printedColor:"red" as const,coreStats:[],summary:"",resourceKey:"card.weapon.w01",badges:[],state:{selected:false,effective:true},detailAvailable:true};
const emptyPlayer={seat:1 as const,team:"A" as const,nickname:"玩家1",connected:true,characterId:"character.knight",lifeState:"inPlay" as const,hp:5,maxHp:5,shield:5,maxShield:5,ironShield:0,handCount:0,handLimit:4,equipment:[equipmentCard],equipmentSlots:{weapon1:equipmentCard,weapon2:null,weapon3:null,thirdWeapon:null,armor:null,mountOffense:null,mountDefense:null,talents:[],boss:null,tripleWield:false,mountOccupied:[],mountDual:false},judgmentZone:[],statuses:[]};
function snapshotWith(){return{type:"GAME_SNAPSHOT" as const,gameId:"g",rulesetVersion:"1.3.4" as const,stateRevision:1,lastEventSeq:1,serverTime:Date.now(),viewer:{userId:"u1",seat:1 as const,team:"A" as const},publicView:{round:1,activeSeat:1 as const,phase:"play" as const,players:[emptyPlayer,{...emptyPlayer,seat:2 as const,equipment:[],equipmentSlots:{weapon1:null,weapon2:null,weapon3:null,thirdWeapon:null,armor:null,mountOffense:null,mountDefense:null,talents:[],boss:null,tripleWield:false,mountOccupied:[]}}],drawPileCount:10,discardTop:[],centralCards:[],headline:undefined,winnerTeam:null},privateView:{hand:[],preselectedWeaponSlot:null,preselectedModeId:null,preselectableWeaponSlots:[],concealedChoices:[]},interaction:{prompt:null,offers:[],disabledHints:[]},chat:[]} as any;}
function mountView(snapshot:any){return mount(GameView,{props:{snapshot,events:[]},global:{stubs:{PromptBanner:true,GameChatPanel:true,GameEventFeed:true,ResourceImage:true,CharacterDetailDrawer:true,CardDetailDrawer:true}}});}

describe("GameView 游戏内右键详情（task7）",()=>{
 it("右键角色条打开角色详情抽屉",async()=>{
  const wrapper=mountView(snapshotWith());
  const drawer=wrapper.findComponent({name:"CharacterDetailDrawer"});
  expect(drawer.exists()).toBe(true);
  expect(drawer.props("candidate")).toBe(null);
  await wrapper.find(".game-player").trigger("contextmenu");
  const candidate=(drawer.props("candidate") as any);
  expect(candidate).not.toBe(null);
  expect(candidate.characterId).toBe("character.knight");
  expect(candidate.displayName).toBe("骑士");
  expect(candidate.initialTalentId).toBe("talent.blue_shield");
 });
 it("右键装备区装备打开装备详情抽屉（且不误开角色详情）",async()=>{
  const wrapper=mountView(snapshotWith());
  const charDrawer=wrapper.findComponent({name:"CharacterDetailDrawer"});
  const cardDrawer=wrapper.findComponent({name:"CardDetailDrawer"});
  await wrapper.find(".equipment-slot .game-card").trigger("contextmenu");
  const card=(cardDrawer.props("card") as any);
  expect(card).not.toBe(null);
  expect(card.ref).toBe("public:w1");
  expect(charDrawer.props("candidate")).toBe(null);
 });
});
