// @vitest-environment jsdom
import {mount, flushPromises} from "@vue/test-utils";
import {describe,expect,it} from "vitest";
import GameChatPanel from "./GameChatPanel.vue";

describe("GameChatPanel",()=>{
 it("emits send with the chosen channel and clears the input",async()=>{const wrapper=mount(GameChatPanel,{props:{messages:[]}});const input=wrapper.find("input");await input.setValue("打的好啊");await wrapper.find("form").trigger("submit");expect(wrapper.emitted("send")![0]).toEqual(["all","打的好啊"]);expect((input.element as HTMLInputElement).value).toBe("");});
 it("switches to team channel and keeps empty input from sending",async()=>{const wrapper=mount(GameChatPanel,{props:{messages:[]}});const teamButton=wrapper.findAll("button").find((b)=>b.text().includes("队伍"))!;await teamButton.trigger("click");const input=wrapper.find("input");await input.setValue("   ");await wrapper.find("form").trigger("submit");expect(wrapper.emitted("send")).toBeUndefined();await input.setValue("队友配合");await wrapper.find("form").trigger("submit");expect(wrapper.emitted("send")!.at(-1)).toEqual(["team","队友配合"]);});
 it("新消息且停留在底部附近时自动滚到底部",async()=>{
  const base={messageId:"m1",channel:"all" as const,senderSeat:1 as const,sentAt:1000,text:"hi"};
  const wrapper=mount(GameChatPanel,{props:{messages:[base]}});
  const list=wrapper.find(".game-chat__list").element as HTMLElement;
  Object.defineProperty(list,"scrollHeight",{configurable:true,value:500});
  Object.defineProperty(list,"clientHeight",{configurable:true,value:180});
  await flushPromises();
  expect(list.scrollTop).toBe(500); // 初始滚到底（jsdom clamp）
  await wrapper.setProps({messages:[base,{messageId:"m2",channel:"all" as const,senderSeat:2 as const,sentAt:2000,text:"你好"}]});
  await flushPromises();
  expect(list.scrollTop).toBe(500);
 });
 it("玩家上滑看历史时新消息不强制拉回",async()=>{
  const base={messageId:"m1",channel:"all" as const,senderSeat:1 as const,sentAt:1000,text:"hi"};
  const wrapper=mount(GameChatPanel,{props:{messages:[base]}});
  const list=wrapper.find(".game-chat__list").element as HTMLElement;
  Object.defineProperty(list,"scrollHeight",{configurable:true,value:500});
  Object.defineProperty(list,"clientHeight",{configurable:true,value:180});
  await flushPromises();
  list.scrollTop=120;
  await wrapper.setProps({messages:[base,{messageId:"m2",channel:"all" as const,senderSeat:2 as const,sentAt:2000,text:"你好"}]});
  await flushPromises();
  expect(list.scrollTop).toBe(120);
 });
});
