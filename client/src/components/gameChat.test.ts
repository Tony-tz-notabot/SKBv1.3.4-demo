// @vitest-environment jsdom
import {mount} from "@vue/test-utils";
import {describe,expect,it} from "vitest";
import GameChatPanel from "./GameChatPanel.vue";

describe("GameChatPanel",()=>{
 it("emits send with the chosen channel and clears the input",async()=>{const wrapper=mount(GameChatPanel,{props:{messages:[]}});const input=wrapper.find("input");await input.setValue("打的好啊");await wrapper.find("form").trigger("submit");expect(wrapper.emitted("send")![0]).toEqual(["all","打的好啊"]);expect((input.element as HTMLInputElement).value).toBe("");});
 it("switches to team channel and keeps empty input from sending",async()=>{const wrapper=mount(GameChatPanel,{props:{messages:[]}});const teamButton=wrapper.findAll("button").find((b)=>b.text().includes("队伍"))!;await teamButton.trigger("click");const input=wrapper.find("input");await input.setValue("   ");await wrapper.find("form").trigger("submit");expect(wrapper.emitted("send")).toBeUndefined();await input.setValue("队友配合");await wrapper.find("form").trigger("submit");expect(wrapper.emitted("send")!.at(-1)).toEqual(["team","队友配合"]);});
});
