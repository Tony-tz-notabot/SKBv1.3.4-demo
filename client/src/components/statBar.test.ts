// @vitest-environment jsdom
// 血盾条组件 TDD：先写失败用例 → 实现 StatBar.vue → 转绿。
// 规格来源：docs/整理/130 §1.5-B（细式、单点长=2×高、数值在左、主题提亮、无边框、失去部分加深+低透明、等宽字体、增减闪烁+弹数字）。
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import StatBar from "./StatBar.vue";

beforeAll(() => {
  const css = readFileSync(join(process.cwd(), "src", "styles", "base.css"), "utf8");
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
});

const mountBar = (props: Record<string, unknown> = {}) =>
  mount(StatBar, { props: { theme: "hp", label: "HP", value: 7, max: 12, ...props } });

describe("StatBar 血盾条", () => {
  it("数值在条左端（value 先于 track）", () => {
    const w = mountBar();
    const value = w.find(".bar__value");
    const track = w.find(".bar__track");
    expect(value.exists()).toBe(true);
    expect(track.exists()).toBe(true);
    const order = value.element.compareDocumentPosition(track.element);
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("轨道宽度 = 上限 × 单点 14px（12 点 = 168px，与装备区等宽）", () => {
    const w = mountBar({ max: 12 });
    expect((w.find(".bar__track").element as HTMLElement).style.width).toBe("168px");
  });

  it("填充宽度 = 当前值 × 14px", () => {
    const w = mountBar({ value: 7, max: 12 });
    expect((w.find(".bar__fill").element as HTMLElement).style.width).toBe("98px");
  });

  it("上限 > 12 时单点按比例收缩，总长保持 168px（如 22 上限）", () => {
    const w = mountBar({ value: 11, max: 22 });
    expect((w.find(".bar__track").element as HTMLElement).style.width).toBe("168px");
    // 单点 ≈168/22≈7.6px，11 点 ≈84px
    expect((w.find(".bar__fill").element as HTMLElement).style.width).toBe("84px");
  });

  it("主题类正确（hp/shield/purple/blue 备用条）", () => {
    expect(mountBar({ theme: "hp" }).find(".bar").classes()).toContain("bar--hp");
    expect(mountBar({ theme: "shield" }).find(".bar").classes()).toContain("bar--shield");
    expect(mountBar({ theme: "purple" }).find(".bar").classes()).toContain("bar--purple");
    expect(mountBar({ theme: "blue" }).find(".bar").classes()).toContain("bar--blue");
  });

  it("无边框（border-style 为 none）", () => {
    const track = mountBar().find(".bar__track").element as HTMLElement;
    expect(getComputedStyle(track).borderStyle).toBe("none");
  });

  it("数值等宽字体 + tabular-nums 防跳动", () => {
    const value = mountBar().find(".bar__value").element as HTMLElement;
    const cs = getComputedStyle(value);
    expect(cs.fontFamily.toLowerCase()).toMatch(/mono|consolas/i);
    expect(cs.fontVariantNumeric).toContain("tabular-nums");
  });

  it("数值文本 = label 当前/上限", () => {
    expect(mountBar({ theme: "shield", label: "SH", value: 5, max: 12 }).find(".bar__value").text()).toBe("SH 5/12");
  });

  it("value 减少：填充触发闪烁类并发出 change(loss) 事件", async () => {
    const w = mountBar({ value: 7 });
    await nextTick();
    await w.setProps({ value: 5 });
    await nextTick();
    await nextTick();
    expect(w.find(".bar__fill--flash").exists()).toBe(true);
    expect(w.emitted("change")?.[0]?.[0]).toMatchObject({ delta: -2, loss: true });
  });

  it("value 增加：发出 change(gain) 事件", async () => {
    const w = mountBar({ value: 7 });
    await nextTick();
    await w.setProps({ value: 9 });
    await nextTick();
    await nextTick();
    expect(w.emitted("change")?.[0]?.[0]).toMatchObject({ delta: 2, loss: false });
  });
});
