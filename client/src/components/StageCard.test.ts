// @vitest-environment jsdom
// StageCard 中央区卡牌 TDD（132 §6/R6/R7：正面/背面、判定成功色光/失败变暗、翻牌动画、迷你条状）。
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import StageCard from "./StageCard.vue";

const mountC = (props: Record<string, unknown>) => mount(StageCard, { props: { cardRef: "private:u1:c1", faceUp: true, ...props } });

describe("StageCard 中央区卡牌", () => {
  it("正面显示牌名（ref 尾段）", () => {
    const w = mountC({});
    expect(w.find(".stage-card").exists()).toBe(true);
    expect(w.find(".stage-card__label").text()).toBe("c1");
  });

  it("背面显示卡背纹样类", () => {
    const w = mountC({ faceUp: false });
    expect(w.find(".stage-card").classes()).toContain("stage-card--back");
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
});
