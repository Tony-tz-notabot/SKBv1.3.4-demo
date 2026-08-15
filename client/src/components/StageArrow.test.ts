// @vitest-environment jsdom
// StageArrow 组件 TDD（132 §4.2/4.3 修订）：standby 白色荧光轮廓；命中时效果色 fill 经 clipPath
// SMIL 从尾部→头部加速揭示（填色渲染并冲击）→ 冲击爆闪 + 淡出；voided 淡出；嵌套透明度、自指环。
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import StageArrow from "./StageArrow.vue";
import { effectColor } from "../stage/effectColors";

const mountA = (props: Record<string, unknown> = {}) =>
  mount(StageArrow, {
    props: { from: { x: 100, y: 200 }, to: { x: 300, y: 200 }, selfLoop: false, phase: "standby", effect: "none", opacity: 1, ...props },
  });

describe("StageArrow 操作指示箭头", () => {
  it("渲染 SVG 与主路径", () => {
    const w = mountA();
    expect(w.find("svg.stage-arrow").exists()).toBe(true);
    expect(w.find("path.stage-arrow__body").exists()).toBe(true);
  });

  it("standby：仅白色荧光轮廓（outline 存在），无填充揭示", () => {
    const w = mountA({ phase: "standby" });
    expect(w.find("path.stage-arrow__outline").exists()).toBe(true);
    expect(w.find("path.stage-arrow__fill").exists()).toBe(false);
    expect(w.find("svg.stage-arrow").classes()).toContain("stage-arrow--standby");
  });

  it("命中（arrive）：效果色 fill + clipPath 揭示（SMIL 尾→头）", () => {
    const w = mountA({ phase: "arrive", effect: "hp" });
    const fill = w.find("path.stage-arrow__fill");
    expect(fill.exists()).toBe(true);
    expect(fill.attributes("fill")).toBe(effectColor("hp"));
    expect(fill.attributes("clip-path")).toMatch(/^url\(#fx-/);
    // clipPath 内的 polygon 携带 animate（from 尾 → to 头）
    expect(w.find("clipPath polygon animate").exists()).toBe(true);
    expect(w.find("clipPath polygon animate").attributes("keySplines")).toBe("0.6 0 1 1");
  });

  it("solid/flow 同样渲染 fill 揭示（fill 色随效果）", () => {
    expect(mountA({ phase: "solid", effect: "shield" }).find("path.stage-arrow__fill").attributes("fill")).toBe(effectColor("shield"));
    expect(mountA({ phase: "flow", effect: "heal" }).find("path.stage-arrow__fill").attributes("fill")).toBe(effectColor("heal"));
  });

  it("voided：无 fill 揭示（仅淡出）", () => {
    const w = mountA({ phase: "voided" });
    expect(w.find("path.stage-arrow__fill").exists()).toBe(false);
    expect(w.find("svg.stage-arrow").classes()).toContain("stage-arrow--voided");
  });

  it("嵌套透明度应用到 svg（R4）", () => {
    const w = mountA({ opacity: 0.35 });
    expect((w.find("svg.stage-arrow").element as HTMLElement).style.opacity).toBe("0.35");
  });

  it("自指环：ring 类", () => {
    expect(mountA({ selfLoop: true }).find("svg.stage-arrow").classes()).toContain("stage-arrow--ring");
  });

  it("bend 透传：不同弯曲值产生不同路径", () => {
    const a = mountA({ bend: 40 });
    const b = mountA({ bend: -40 });
    expect(a.find("path.stage-arrow__body").attributes("d")).not.toBe(b.find("path.stage-arrow__body").attributes("d"));
  });

  it("svg 带 viewBox 600x500（600x500 逻辑坐标拉伸对齐表格面板）", () => {
    const w = mountA();
    const svg = w.find("svg.stage-arrow");
    expect(svg.attributes("viewBox")).toBe("0 0 600 500");
    expect(svg.attributes("preserveAspectRatio")).toBe("none");
  });
});
