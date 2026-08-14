// @vitest-environment jsdom
// StageNarration 主区词条渲染 TDD（132 §5：token 段渲染，复用 128 三色系类）。
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import StageNarration from "./StageNarration.vue";

describe("StageNarration 主区词条", () => {
  it("渲染 token 段（关系色/语义色类）", () => {
    const w = mount(StageNarration, {
      props: {
        lines: [
          { id: "n1", seq: 1, segments: [{ text: "角色1", cls: "rel-self" }, { text: "攻击", cls: null }, { text: "护盾-2", cls: "sem-shield" }] },
        ],
      },
    });
    expect(w.find(".stage-narration__line").text()).toBe("角色1攻击护盾-2");
    expect(w.find(".rel-self").exists()).toBe(true);
    expect(w.find(".sem-shield").exists()).toBe(true);
  });

  it("空词条渲染空容器", () => {
    const w = mount(StageNarration, { props: { lines: [] } });
    expect(w.find(".stage-narration").exists()).toBe(true);
    expect(w.findAll(".stage-narration__line")).toHaveLength(0);
  });
});
