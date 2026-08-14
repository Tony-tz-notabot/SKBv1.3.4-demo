// 效果→颜色映射 TDD（132 §4.3：复用 128 语义色）。
import { describe, expect, it } from "vitest";
import { effectColor, effectKindFromSegment } from "./effectColors";

describe("effectColors 效果→颜色", () => {
  it("映射全部语义色", () => {
    expect(effectColor("hp")).toBe("#ff8a7a");
    expect(effectColor("shield")).toBe("#9fb3bd");
    expect(effectColor("heal")).toBe("#6fdda0");
    expect(effectColor("draw")).toBe("#7fc4e8");
    expect(effectColor("fire")).toBe("#ffb37a");
    expect(effectColor("poison")).toBe("#3da86b");
    expect(effectColor("electric")).toBe("#ffd27b");
    expect(effectColor("frozen")).toBe("#7fc4e8");
    expect(effectColor("judgment")).toBe("#eaf6ff");
    expect(effectColor("cost")).toBe("#efd27b");
    expect(effectColor("none")).toBe("#eaf6ff");
  });

  it("未知效果回退 none 白", () => {
    expect(effectColor("unknown" as never)).toBe("#eaf6ff");
  });

  it("伤害段推断效果类型：扣血→hp、扣盾→shield、均无→none", () => {
    expect(effectKindFromSegment({ hpLost: 2, shieldLost: 0 })).toBe("hp");
    expect(effectKindFromSegment({ hpLost: 0, shieldLost: 3 })).toBe("shield");
    expect(effectKindFromSegment({ hpLost: 0, shieldLost: 0 })).toBe("none");
  });
});
