// @vitest-environment jsdom
// GameView × CombatStage 集成回归（M5）：真实组件树内事件→舞台（箭头/词条/飞行卡/牌堆）。
import { mount } from "@vue/test-utils";
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import GameView from "./GameView.vue";

beforeAll(() => {
  const css = readFileSync(join(process.cwd(), "src", "styles", "base.css"), "utf8");
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
});

const emptyPlayer = {
  seat: 1 as const, team: "A" as const, nickname: "玩家1", connected: true, characterId: "character.knight", lifeState: "inPlay" as const,
  hp: 5, maxHp: 5, shield: 5, maxShield: 5, ironShield: 0, handCount: 0, handLimit: 4, equipment: [],
  equipmentSlots: { weapon1: null, weapon2: null, weapon3: null, thirdWeapon: null, armor: null, mountOffense: null, mountDefense: null, talents: [], boss: null, tripleWield: false, mountOccupied: [], mountDual: false },
  judgmentZone: [], statuses: [],
};
const players = [emptyPlayer, { ...emptyPlayer, seat: 2 as const, team: "B" as const }, { ...emptyPlayer, seat: 3 as const, team: "B" as const }, { ...emptyPlayer, seat: 4 as const }];

function snapshotWith(events: unknown[]) {
  return {
    type: "GAME_SNAPSHOT" as const, gameId: "g", rulesetVersion: "1.3.4" as const, stateRevision: 1, lastEventSeq: 10, serverTime: Date.now(),
    viewer: { userId: "u1", seat: 1 as const, team: "A" as const },
    publicView: { round: 1, activeSeat: 1 as const, phase: "play" as const, players, drawPileCount: 20, discardTop: [], centralCards: [], headline: undefined, winnerTeam: null },
    privateView: { hand: [], preselectedWeaponSlot: null, preselectedModeId: null, preselectableWeaponSlots: [], concealedChoices: [] },
    interaction: { prompt: null, offers: [], disabledHints: [] },
    chat: [], log: [],
    ...(events.length ? { __events: undefined } : {}),
  } as any;
}

const mountView = (events: unknown[] = []) =>
  mount(GameView, {
    props: { snapshot: snapshotWith(events), events: events as any, canDisbandRoom: false },
    global: {
      stubs: { GamePlayerPanel: true, PromptBanner: true, ResourceImage: true, MatchLogPanel: true, GameChatPanel: true, CardDetailDrawer: true, CharacterDetailDrawer: true },
    },
  });

describe("GameView × CombatStage 集成（M5）", () => {
  it("渲染中央战斗区：主区/牌堆/弃牌堆 + 牌堆数量（快照直供）", () => {
    const w = mountView();
    expect(w.find(".combat-stage").exists()).toBe(true);
    expect(w.find(".stage-pile .pile-count").text()).toBe("20");
    expect(w.find(".stage-main").exists()).toBe(true);
    expect(w.find(".stage-temp").exists(), "临时弃牌区已移除").toBe(false);
    expect(w.find(".stage-discard").exists()).toBe(true);
  });

  it("攻击声明事件 → 操作箭头（standby）+ 主区词条", () => {
    const w = mountView([
      { eventSeq: 1, eventType: "ATTACK_DECLARED", payload: { attackerSeat: 1, targetRefs: [] } },
      { eventSeq: 2, eventType: "ATTACK_TARGETED", payload: { attackerSeat: 1, targetRefs: ["public:seat_3"] } },
    ]);
    const arrow = w.find(".stage-arrow");
    expect(arrow.exists(), "应渲染操作箭头").toBe(true);
    expect(arrow.classes()).toContain("stage-arrow--standby");
    expect(w.find(".stage-narration").text()).toContain("攻击");
  });

  it("摸牌事件 → 飞行卡（正面）", () => {
    const w = mountView([{ eventSeq: 2, eventType: "CARD_DRAWN", payload: { seat: 1, count: 2, cardRefs: ["private:u1:c1", "private:u1:c2"] } }]);
    expect(w.findAll(".stage-flight").length).toBe(2);
    expect(w.find(".stage-flight--face").exists()).toBe(true);
  });

  it("出牌+攻击+结算 → 主区牌 → 弃牌堆条状", () => {
    const w = mountView([
      { eventSeq: 1, eventType: "CARD_PLAYED", payload: { seat: 1, cardRef: "private:u1:c1", purpose: "attack" } },
      { eventSeq: 2, eventType: "ATTACK_DECLARED", payload: { attackerSeat: 1, targetRefs: ["public:seat_3"] } },
      { eventSeq: 3, eventType: "ATTACK_RESOLVED", payload: { attackId: "a1", result: "resolved", outcome: "hit" } },
    ]);
    expect(w.find(".stage-main .stage-card").exists()).toBe(false);
    expect(w.find(".stage-discard .stage-card").exists()).toBe(true);
    expect(w.find(".stage-narration").text()).toContain("命中");
  });

  it("prefers-reduced-motion 降级块存在（130 I1）", () => {
    const css = readFileSync(join(process.cwd(), "src", "styles", "base.css"), "utf8");
    expect(css).toMatch(/prefers-reduced-motion/);
  });
});
