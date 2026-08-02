// @vitest-environment jsdom
import {mount} from "@vue/test-utils";
import {describe,expect,it} from "vitest";
import GameCard from "./GameCard.vue";
import ResourceImage from "./ResourceImage.vue";
import GamePlayerPanel from "./GamePlayerPanel.vue";

const card=(overrides:Record<string,unknown>={})=>({ref:"card:1",templateId:"basic.kill.white",displayName:"杀",category:"basic" as const,printedColor:"white" as const,coreStats:[],summary:"攻击",resourceKey:"card.basic.kill.white",badges:[],state:{selected:false,effective:true},detailAvailable:false,...overrides});

describe("GameCard",()=>{
 it("highlights legal cards and emits select on click",async()=>{const wrapper=mount(GameCard,{props:{card:card(),legal:true}});expect(wrapper.find(".game-card--legal").exists()).toBe(true);await wrapper.find(".game-card").trigger("click");expect(wrapper.emitted("select")![0]).toEqual(["card:1"]);});
 it("shows disabled reason and emits detail",async()=>{const wrapper=mount(GameCard,{props:{card:card({state:{selected:false,effective:false},detailAvailable:true}),disabledReason:"装备失效"}});expect(wrapper.find(".game-card--disabled").exists()).toBe(true);expect(wrapper.find(".game-card__disabled-hint").exists()).toBe(true);await wrapper.find(".game-card__detail").trigger("click");expect(wrapper.emitted("detail")![0]![0]).toMatchObject({ref:"card:1"});});
});

describe("ResourceImage",()=>{
 it("starts with the first candidate and falls back on error",async()=>{const wrapper=mount(ResourceImage,{props:{resourceKey:"character.character.knight",alt:"骑士"}});const img=wrapper.find("img");const first=(img.element as HTMLImageElement).src;await img.trigger("error");const second=(wrapper.find("img").element as HTMLImageElement).src;expect(second).not.toBe(first);});
});

describe("GamePlayerPanel",()=>{
 const player=(overrides:Record<string,unknown>={})=>({seat:1 as const,team:"A" as const,nickname:"玩家1",connected:true,characterId:"character.knight",lifeState:"inPlay" as const,hp:5,maxHp:5,shield:5,maxShield:5,ironShield:0,handCount:4,equipment:[],equipmentSlots:{weapon1:null,weapon2:null,thirdWeapon:null,armor:null,mountOffense:null,mountDefense:null,talents:[],boss:null},judgmentZone:[],statuses:[],...overrides});
 it("marks legal equipment cards and emits cardSelect",async()=>{const weapon=card({ref:"card:w1",templateId:"weapon.w06"}),wrapper=mount(GamePlayerPanel,{props:{player:player({equipmentSlots:{weapon1:weapon,weapon2:null,thirdWeapon:null,armor:null,mountOffense:null,mountDefense:null,talents:[],boss:null}}),active:true,local:true,legalCardRefs:new Set(["card:w1"])}});const legalCard=wrapper.find(".game-card--legal");expect(legalCard.exists()).toBe(true);await legalCard.trigger("click");expect(wrapper.emitted("cardSelect")![0]).toEqual(["card:w1"]);});
 it("marks the player panel legal target and emits select",async()=>{const wrapper=mount(GamePlayerPanel,{props:{player:player(),active:false,local:false,legalTarget:true}});expect(wrapper.find(".game-player--legal").exists()).toBe(true);await wrapper.find(".game-player").trigger("click");expect(wrapper.emitted("select")![0]).toEqual(["public:seat_1"]);});
});
