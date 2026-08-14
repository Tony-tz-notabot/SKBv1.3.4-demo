// @vitest-environment jsdom
// StageArrow 组件 TDD（132 §4.2/4.3）：白色荧光轮廓/实体化/能量流（按效果色）/到达/无效淡出、嵌套透明度、自指环。
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import StageArrow from "./StageArrow.vue";

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

  it("standby：仅白色荧光轮廓（outline 存在 + standby 类）", () => {
    const w = mountA({ phase: "standby" });
    expect(w.find("path.stage-arrow__outline").exists()).toBe(true);
    expect(w.find("svg.stage-arrow").classes()).toContain("stage-arrow--standby");
  });

  it("solid：实体化类", () => {
    expect(mountA({ phase: "solid" }).find("svg.stage-arrow").classes()).toContain("stage-arrow--solid");
  });

  it("flow：能量层按效果颜色（--effect 变量）", () => {
    const w = mountA({ phase: "flow", effect: "hp" });
    expect(w.find("path.stage-arrow__energy").exists()).toBe(true);
    expect((w.find("path.stage-arrow__energy").element as HTMLElement).style.getPropertyValue("--effect")).toBe("#ff8a7a");
  });

  it("arrive / voided：对应状态类", () => {
    expect(mountA({ phase: "arrive" }).find("svg.stage-arrow").classes()).toContain("stage-arrow--arrive");
    expect(mountA({ phase: "voided" }).find("svg.stage-arrow").classes()).toContain("stage-arrow--voided");
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
});
