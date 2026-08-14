// 操作箭头几何 TDD（132 §4.1：作战地图风宽箭头——尾巴宽且中间自然凹陷、主体两侧弧线、大箭头头；自指环）。
import { describe, expect, it } from "vitest";
import { buildArrowPath, buildRingPath } from "./arrowPath";

describe("arrowPath 宽箭头几何", () => {
  it("主路径以头部尖端起始，侧边为弧线（C 命令）", () => {
    const g = buildArrowPath({ x: 100, y: 100 }, { x: 300, y: 100 });
    expect(g.path.startsWith("M")).toBe(true);
    expect(g.path).toContain("C");
    expect(g.headTip).toEqual({ x: 300, y: 100 });
  });

  it("尾部中间自然凹陷：凹点比尾中心更靠后（沿 -d 方向）", () => {
    const g = buildArrowPath({ x: 100, y: 100 }, { x: 300, y: 100 });
    expect(g.notch.x).toBeLessThan(g.tailCenter.x);
    expect(Math.abs(g.notch.y - 100)).toBeLessThan(2);
  });

  it("箭头大：头部长度随长度比例（headRatio 默认 ~1/3）", () => {
    const g = buildArrowPath({ x: 0, y: 0 }, { x: 300, y: 0 });
    expect(g.headBaseX).toBeGreaterThan(150); // 头基在距尖端 ~96px 内 → 基座 x > 300-96=204? 用比例断言
    expect(g.headBaseX).toBeLessThan(250);
  });

  it("宽度可调：width 选项增大 → 箭头变宽", () => {
    const slim = buildArrowPath({ x: 0, y: 0 }, { x: 200, y: 0 }, { width: 10 });
    const wide = buildArrowPath({ x: 0, y: 0 }, { x: 200, y: 0 }, { width: 40 });
    expect(wide.width).toBeGreaterThan(slim.width);
  });

  it("垂直方向（向上攻击）方向正确", () => {
    const g = buildArrowPath({ x: 100, y: 200 }, { x: 100, y: 50 });
    expect(g.headTip).toEqual({ x: 100, y: 50 });
    expect(g.notch.y).toBeGreaterThan(g.tailCenter.y); // 向上时凹点偏下（向后）
  });

  it("短距离不产生 NaN", () => {
    const g = buildArrowPath({ x: 10, y: 10 }, { x: 12, y: 10 });
    expect(g.path).not.toContain("NaN");
  });

  it("bend 弯曲：控制点横向偏移（多目标扇形用），默认 0", () => {
    const g = buildArrowPath({ x: 0, y: 0 }, { x: 200, y: 0 }, { bend: 40 });
    expect(g.bendExtent).toBe(40);
    const flat = buildArrowPath({ x: 0, y: 0 }, { x: 200, y: 0 });
    expect(flat.bendExtent).toBe(0);
  });
});

describe("arrowPath 自指环", () => {
  it("环形路径：含圆弧 A 命令，尖端位于环半径上", () => {
    const g = buildRingPath({ x: 100, y: 100 }, 40);
    expect(g.ring).toBe(true);
    expect(g.path).toContain("A");
    const d = Math.hypot(g.headTip.x - 100, g.headTip.y - 100);
    expect(Math.abs(d - 40)).toBeLessThan(2);
    expect(g.path).not.toContain("NaN");
  });

  it("环起点（尾巴）与尖端之间留开口，尖端贴近起点（绕成一圈）", () => {
    const g = buildRingPath({ x: 100, y: 100 }, 40);
    const gap = Math.hypot(g.headTip.x - g.tailStart!.x, g.headTip.y - g.tailStart!.y);
    expect(gap).toBeLessThan(40 * 0.65);
  });
});
