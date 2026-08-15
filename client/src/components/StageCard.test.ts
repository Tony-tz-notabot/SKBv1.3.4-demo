// @vitest-environment jsdom
// StageCard 中央区卡牌 TDD（132 §6/R6/R7：正面/背面、判定成功色光/失败变暗、翻牌动画、迷你条状）。
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import StageCard from "./StageCard.vue";

const mountC = (props: Record<string, unknown>) => mount(StageCard, { props: { cardRef: "private:u1:c1", faceUp: true, ...props } });

describe("StageCard 中央区卡牌", () => {
  it("正面（无 templateId）渲染默认占位图，不显示编号", () => {
    const w = mount(StageCard, {
      props: { cardRef: "public:card:0055", faceUp: true },
      global: { stubs: { ResourceImage: { template: '<img class="ri" :src="resourceKey" />', props: ["resourceKey"] } } },
    });
    expect(w.find(".ri").exists()).toBe(true);
    expect(w.find(".ri").attributes("src")).toBe("card.unknown");
    expect(w.find(".stage-card__back-mark").exists()).toBe(false);
  });

  it("背面统一 SKB 卡背（不显示图片/编号）", () => {
    const w = mount(StageCard, {
      props: { cardRef: "public:card:0055", faceUp: false, templateId: "basic.kill.blue" },
      global: { stubs: { ResourceImage: { template: '<img class="ri" />' } } },
    });
    expect(w.find(".ri").exists()).toBe(false);
    expect(w.find(".stage-card").classes()).toContain("stage-card--back");
    expect(w.find(".stage-card__back-mark").text()).toBe("SKB");
  });

  it("判定成功：高亮类 + 边缘色光（--glow 按印刷色）", () => {
    const w = mountC({ printedColor: "red", highlight: "success" });
    expect(w.find(".stage-card").classes()).toContain("stage-card--success");
    expect((w.find(".stage-card").element as HTMLElement).style.getPropertyValue("--glow")).toBe("#ff9aa8");
  });

  it("判定失败：变暗类", () => {
    const w = mountC({ highlight: "fail" });
    expect(w.find(".stage-card").classes()).toContain("stage-card--fail");
  });

  it("翻牌入场（判定）：flip-in 类", () => {
    const w = mountC({ flipIn: true });
    expect(w.find(".stage-card").classes()).toContain("stage-card--flip-in");
  });

  it("迷你条状（弃牌堆）：mini 类", () => {
    const w = mountC({ mini: true });
    expect(w.find(".stage-card").classes()).toContain("stage-card--mini");
  });

  it("带 templateId 的正面牌：渲染牌面图片（resourceKey=card.<templateId>），不显示文字编号", () => {
    const w = mount(StageCard, {
      props: { cardRef: "public:card:0055", faceUp: true, templateId: "basic.kill.blue" },
      global: { stubs: { ResourceImage: { template: '<img class="ri" :src="resourceKey" />', props: ["resourceKey"] } } },
    });
    const img = w.find(".ri");
    expect(img.exists()).toBe(true);
    expect(img.attributes("src")).toBe("card.basic.kill.blue");
    expect(w.find(".stage-card__label").exists()).toBe(false);
  });

  it("背面牌不显示图片（仅卡背纹样）", () => {
    const w = mount(StageCard, {
      props: { cardRef: "public:card:0055", faceUp: false, templateId: "basic.kill.blue" },
      global: { stubs: { ResourceImage: { template: '<img class="ri" />' } } },
    });
    expect(w.find(".ri").exists()).toBe(false);
    expect(w.find(".stage-card").classes()).toContain("stage-card--back");
  });
});
