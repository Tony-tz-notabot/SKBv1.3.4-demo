// @vitest-environment jsdom
// 按钮可辨识性回归：元素锦囊各具名、逐牌选择窗口按钮显示牌名/手牌N、C6 两模式可区分。
import {mount} from "@vue/test-utils";
import {describe,expect,it} from "vitest";
import GameView from "./GameView.vue";

const emptyPlayer={seat:1 as const,team:"A" as const,nickname:"玩家1",connected:true,characterId:"character.knight",lifeState:"inPlay" as const,hp:5,maxHp:5,shield:5,maxShield:5,ironShield:0,handCount:0,handLimit:4,equipment:[],equipmentSlots:{weapon1:null,weapon2:null,weapon3:null,thirdWeapon:null,armor:null,mountOffense:null,mountDefense:null,talents:[],boss:null,tripleWield:false,mountOccupied:[],mountDual:false},judgmentZone:[],statuses:[]};
const weaponCard={ref:"public:c-w1",templateId:"weapon.w23",displayName:"手里剑",category:"weapon" as const,printedColor:"white" as const,coreStats:[],summary:"",resourceKey:"card.weapon.w23",badges:[],state:{selected:false,effective:true},detailAvailable:true};
const player1={...emptyPlayer,equipmentSlots:{weapon1:weaponCard,weapon2:null,weapon3:null,thirdWeapon:null,armor:null,mountOffense:null,mountDefense:null,talents:[],boss:null,tripleWield:false,mountOccupied:[],mountDual:false},equipment:[weaponCard],handCount:1};
function snapshotWith(offers:any[],promptKind:string="playPhaseAction"){return{type:"GAME_SNAPSHOT" as const,gameId:"g",rulesetVersion:"1.3.4" as const,stateRevision:1,lastEventSeq:1,serverTime:Date.now(),viewer:{userId:"u1",seat:1 as const,team:"A" as const},publicView:{round:1,activeSeat:1 as const,phase:"play" as const,players:[player1,{...emptyPlayer,seat:2 as const}],drawPileCount:10,discardTop:[],centralCards:[],headline:undefined,winnerTeam:null},privateView:{hand:[],preselectedWeaponSlot:null,preselectedModeId:null,preselectableWeaponSlots:["weapon:1:1"],concealedChoices:[]},interaction:{prompt:{promptId:"p:1",kind:promptKind,mandatory:false,deadlineAt:Date.now()+10000,prioritySeat:1 as const,timeoutPolicy:"pass" as const},offers,disabledHints:[]},chat:[]} as any;}
function mountView(snapshot:any){return mount(GameView,{props:{snapshot,events:[]},global:{stubs:{PromptBanner:true,GameEventFeed:true,GameChatPanel:true,CardDetailDrawer:true,CharacterDetailDrawer:true,ResourceImage:true}}});}
const labels=(wrapper:any):string[]=>wrapper.findAll(".offer-list .button").map((b:any)=>b.text() as string);

describe("按钮可辨识性",()=>{
 it("元素锦囊：三个锦囊按钮各自具名（冰冻/雷电/烈焰），不再全是「元素锦囊」",()=>{
  const offers=["frozen","electrified","flame"].map(m=>({offerId:`offer:skill.ancient_elementalist.element_satchel:${m}`,kind:"activateAbility" as const,sourceRefs:[],legalTargetRefs:["public:seat_2","public:seat_3"],selectionSpecs:[{key:"targets",kind:"targets",min:1,max:1,distinct:true,legalRefs:["public:seat_2","public:seat_3"]}],preview:{costSummary:null}}));
  const wrapper=mountView(snapshotWith(offers)),texts=labels(wrapper);
  expect(texts.some(t=>t.includes("冰冻锦囊")),"应有冰冻锦囊按钮").toBe(true);
  expect(texts.some(t=>t.includes("雷电锦囊")),"应有雷电锦囊按钮").toBe(true);
  expect(texts.some(t=>t.includes("烈焰锦囊")),"应有烈焰锦囊按钮").toBe(true);
  expect(texts.filter(t=>t==="元素锦囊").length,"不应再出现无区分度的元素锦囊按钮").toBe(0);
 });
 it("拆牌/拿牌（逐牌选择）：目标手牌按钮显示「手牌N」而非「确认选择」",()=>{
  const offers=[0,1].map(i=>({offerId:`offer:statue-card:${i}`,kind:"resolveChoice" as const,sourceRefs:[`concealed:p:${i}`],legalTargetRefs:[],selectionSpecs:[],preview:{costSummary:null}}));
  const wrapper=mountView(snapshotWith(offers,"statueCardSelection")),texts=labels(wrapper);
  expect(texts[0]).toBe("手牌1");
  expect(texts[1]).toBe("手牌2");
 });
 it("拆牌/拿牌（逐牌选择）：目标装备区牌按钮显示具体牌名",()=>{
  const offers=[{offerId:"offer:statue-card:0",kind:"resolveChoice" as const,sourceRefs:["public:c-w1"],legalTargetRefs:[],selectionSpecs:[],preview:{costSummary:null}}];
  const wrapper=mountView(snapshotWith(offers,"statueCardSelection")),texts=labels(wrapper);
  expect(texts.some(t=>t.includes("手里剑")),"按钮应显示目标装备区牌名").toBe(true);
 });
 it("C6H8O6：激光扫射与定点轰击两个模式按钮可区分",()=>{
  const offers=[{offerId:"offer:boss-use:c6-sweep:card:01",kind:"useCard" as const,sourceRefs:["public:c-c6"],legalTargetRefs:[],selectionSpecs:[],preview:{costSummary:null}},{offerId:"offer:boss-use:c6-bomb:card:01",kind:"useCard" as const,sourceRefs:["public:c-c6"],legalTargetRefs:["public:seat_2"],selectionSpecs:[{key:"targets",kind:"targets",min:1,max:1,distinct:true,legalRefs:["public:seat_2"]}],preview:{costSummary:null}}];
  const wrapper=mountView(snapshotWith(offers)),texts=labels(wrapper);
  expect(texts.some(t=>t.includes("激光扫射")),"应有激光扫射模式按钮").toBe(true);
  expect(texts.some(t=>t.includes("定点轰击")),"应有定点轰击模式按钮").toBe(true);
  expect(texts.some(t=>t==="使用C6H8O6"),"不应再出现两个无区分的「使用C6H8O6」").toBe(false);
 });
});
