// 130 动效批次（批1 纯 CSS）存在性断言（animations.css 内容级）。
// 注：jsdom 不计算 animation-name（恒 none），故沿用 gameViewLayout 的 CSS 文件断言模式。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = () => readFileSync(join(process.cwd(), "src", "styles", "animations.css"), "utf8");

describe("130 动效批次 1（animations.css 声明存在性）", () => {
  it("A1 阶段药丸：span 过渡 + active phase-pop", () => {
    const c = css();
    expect(c).toMatch(/\.phase-track span\s*\{[^}]*transition[^}]*\}/);
    expect(c).toMatch(/\.phase-track span\.active\s*\{[^}]*phase-pop/);
  });

  it("A3 行动玩家呼吸光环（常驻）", () => {
    expect(css()).toMatch(/\.game-player--active\s*\{[^}]*active-breathe/);
  });

  it("B1 摸牌入场 card-in / B2 隐藏牌 fade-in", () => {
    const c = css();
    expect(c).toMatch(/\.hand-cards \.game-card\s*\{[^}]*card-in/);
    expect(c).toMatch(/\.concealed-choice\s*\{[^}]*fade-in/);
  });

  it("C1 弃牌堆条状 discard-in / C2 主区 card-in / C3 牌库 pile-pop", () => {
    const c = css();
    expect(c).toMatch(/\.stage-discard \.stage-card\s*\{[^}]*discard-in/);
    expect(c).toMatch(/\.stage-main__cards \.stage-card[^}]*card-in/);
    expect(c).toMatch(/\.stage-pile \.pile-count\s*\{[^}]*pile-pop/);
  });

  it("D4 感电芯片 fade-in", () => {
    expect(css()).toMatch(/\.status-icons \.chip--electric\s*\{[^}]*fade-in/);
  });

  it("E1 报价按钮 offer-in / E3 选择角标 badge-pop", () => {
    const c = css();
    expect(c).toMatch(/\.offer-list \.button\s*\{[^}]*offer-in/);
    expect(c).toMatch(/\.selection-order\s*\{[^}]*badge-pop/);
  });

  it("F1 提示横幅 banner-in", () => {
    expect(css()).toMatch(/\.prompt-banner\s*\{[^}]*banner-in/);
  });

  it("H1 抽屉 drawer-in + 背板 fade-in / H2 确认框 dialog-in", () => {
    const c = css();
    expect(c).toMatch(/\.detail-drawer\s*\{[^}]*drawer-in/);
    expect(c).toMatch(/\.detail-backdrop\s*\{[^}]*fade-in/);
    expect(c).toMatch(/\.confirm-dialog__card\s*\{[^}]*dialog-in/);
  });

  it("D2 濒死抖动 player-shake + 淘汰淡出 transition", () => {
    const c = css();
    expect(c).toMatch(/\.game-player\.player-shake\s*\{[^}]*player-shake/);
    expect(c).toMatch(/\.game-player--out\s*\{[^}]*transition[^}]*\}/);
  });

  it("全部 keyframes 定义齐全", () => {
    const c = css();
    for (const kf of ["phase-pop", "active-breathe", "card-in", "fade-in", "discard-in", "pile-pop", "offer-in", "badge-pop", "banner-in", "drawer-in", "dialog-in", "player-shake"]) {
      expect(c, `@keyframes ${kf}`).toContain(`@keyframes ${kf}`);
    }
  });
});
