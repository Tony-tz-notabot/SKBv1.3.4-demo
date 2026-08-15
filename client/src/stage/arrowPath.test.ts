// 操作箭头几何 TDD（132 §4.1 修订：↑ 楔形行军图箭头——尖头+等宽柄、直线侧边；自指环）。
import { describe, expect, it } from "vitest";
import { buildArrowPath, buildRingPath } from "./arrowPath";

describe("arrowPath ↑ 楔形箭头几何", () => {
  it("主路径以头部尖端起始，直线侧边构成（L 命令，无弧线）", () => {
    const g = buildArrowPath({ x: 100, y: 100 }, { x: 300, y: 100 });
    expect(g.path.startsWith("M")).toBe(true);
    expect(g.path).not.toContain("C");
    expect(g.path).toContain("L");
    expect(g.headTip.x).toBeCloseTo(300, 0);
    expect(g.headTip.y).toBeCloseTo(100, 0);
  });

  it("尾部中心位于起始端，头部在目标端（轴向尖端）", () => {
    const g = buildArrowPath({ x: 100, y: 100 }, { x: 300, y: 100 });
    expect(g.tailCenter).toEqual({ x: 100, y: 100 });
  });

  it("填充揭示 fillClip：from 为尾部小三角（尖端贴近尾部）、to 为头部大三角（尖端到目标）", () => {
    const g = buildArrowPath({ x: 0, y: 0 }, { x: 200, y: 0 });
    const parse = (s: string) => s.split(" ").map((pair) => pair.split(",").map(Number));
    const from = parse(g.fillClip.from), to = parse(g.fillClip.to);
    expect(from).toHaveLength(3);
    expect(to).toHaveLength(3);
    // from 尖端在尾部附近（x 小），to 尖端到目标（x≈200）
    expect(from[0]![0]!).toBeLessThan(40);
    expect(to[0]![0]!).toBeGreaterThan(190);
    // 底边（顶点2/3）两端保持（尾左右）
    expect(from[1]).toEqual(to[1]);
    expect(from[2]).toEqual(to[2]);
  });

  it("宽度可调：width 选项增大 → 箭头变宽", () => {
    const slim = buildArrowPath({ x: 0, y: 0 }, { x: 200, y: 0 }, { width: 10 });
    const wide = buildArrowPath({ x: 0, y: 0 }, { x: 200, y: 0 }, { width: 40 });
    expect(wide.width).toBeGreaterThan(slim.width);
  });

  it("垂直方向（向上攻击）方向正确", () => {
    const g = buildArrowPath({ x: 100, y: 200 }, { x: 100, y: 50 });
    expect(g.headTip.x).toBeCloseTo(100, 0);
    expect(g.headTip.y).toBeCloseTo(50, 0);
  });

  it("短距离不产生 NaN", () => {
    const g = buildArrowPath({ x: 10, y: 10 }, { x: 12, y: 10 });
    expect(g.path).not.toContain("NaN");
    expect(g.fillClip.from).not.toContain("NaN");
    expect(g.fillClip.to).not.toContain("NaN");
  });

  it("bend 弯曲：整体法线偏移（多目标扇形用），默认 0", () => {
    const bent = buildArrowPath({ x: 0, y: 0 }, { x: 200, y: 0 }, { bend: 40 });
    const flat = buildArrowPath({ x: 0, y: 0 }, { x: 200, y: 0 });
    expect(Math.abs(bent.headTip.y)).toBeCloseTo(40, 0);
    expect(flat.headTip.y).toBeCloseTo(0, 0);
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
