// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import GamePlayerPanel from "./GamePlayerPanel.vue";

// 注入真实全局样式，让 getComputedStyle 反映 base.css 的实际规则。
beforeAll(() => {
  const css = readFileSync(join(process.cwd(), "src", "styles", "base.css"), "utf8");
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
});

const card = (ref: string) => ({
  ref,
  templateId: "weapon.w06",
  displayName: "武器",
  category: "weapon" as const,
  printedColor: "green" as const,
  coreStats: [],
  summary: "",
  resourceKey: "card.weapon.w06",
  badges: [],
  state: { selected: false, effective: true },
  detailAvailable: false,
});

const player = (overrides: Record<string, unknown> = {}) => ({
  seat: 1 as const,
  team: "A" as const,
  nickname: "玩家1",
  connected: true,
  characterId: "character.knight",
  lifeState: "inPlay" as const,
  hp: 5,
  maxHp: 5,
  shield: 5,
  maxShield: 5,
  ironShield: 0,
  handCount: 4,
  handLimit: 4,
  equipment: [],
  equipmentSlots: {
    weapon1: null,
    weapon2: null,
    weapon3: null,
    thirdWeapon: null,
    armor: null,
    mountOffense: null,
    mountDefense: null,
    talents: [],
    boss: null,
    tripleWield: false,
    mountOccupied: [],
    mountDual: false,
  },
  judgmentZone: [],
  statuses: [],
  ...overrides,
});

const fullEquipment = {
  weapon1: card("card:w1"),
  weapon2: card("card:w2"),
  weapon3: null,
  thirdWeapon: card("card:w3"),
  armor: card("card:a1"),
  mountOffense: card("card:m1"),
  mountDefense: card("card:m2"),
  talents: [card("card:t1"), card("card:t2")],
  boss: card("card:b1"),
  tripleWield: false,
  mountOccupied: ["card:m1", "card:m2"],
  mountDual: false,
};

// 判定“是否具备三持”（初始天赋或已装备三持天赋牌）与是否占双槽坐骑，均可由本组件根据 player 推导。
const tripleWieldPlayer = (over: Record<string, unknown> = {}) => player({
  equipmentSlots: { ...fullEquipment, weapon3: card("card:w3r"), thirdWeapon: null },
  ...over,
});

describe("GamePlayerPanel 角色条", () => {
  it("装备区不使用横向滚动（无拉动条），允许换行", () => {
    const wrapper = mount(GamePlayerPanel, { props: { player: player({ equipmentSlots: fullEquipment }), active: false, local: false } });
    const slots = wrapper.find(".equipment-slots").element as HTMLElement;
    const cs = getComputedStyle(slots);
    expect(cs.overflowX, "overflowX 应为 visible 而非 auto/scroll，否则出现拉动条").not.toMatch(/auto|scroll/);
    expect(cs.flexWrap, "flexWrap 应为 wrap，让多件装备换行显示").toBe("wrap");
  });

  it("角色条面板高度足以容纳换行后的装备区（无需滚动）", () => {
    const wrapper = mount(GamePlayerPanel, { props: { player: player({ equipmentSlots: fullEquipment }), active: false, local: false } });
    const panel = wrapper.find(".game-player").element as HTMLElement;
    const minHeight = parseFloat(getComputedStyle(panel).minHeight);
    expect(minHeight, `min-height 应为 ${minHeight}px，过短会截断/需要拉动`).toBeGreaterThanOrEqual(140);
  });
});

describe("GamePlayerPanel 装备槽固定 2 行（task20）", () => {
  // 槽位以 data-slot 属性区分（牌面只显示卡牌名，空槽才显示标签文字）。
  const slotOf = (wrapper: ReturnType<typeof mount>, slot: string) => {
    const el = wrapper.find(`.equipment-slot[data-slot="${slot}"]`);
    expect(el.exists(), `应存在槽 ${slot}`).toBe(true);
    return el;
  };

  it("无三持时只渲染 武1/武2/武3（第三武器），不渲染 武3常规槽；渲染 攻骑/防骑", () => {
    const wrapper = mount(GamePlayerPanel, { props: { player: player({ equipmentSlots: fullEquipment }), active: false, local: false } });
    expect(slotOf(wrapper, "weapon:1:1").exists()).toBe(true);
    expect(slotOf(wrapper, "weapon:2:1").exists()).toBe(true);
    // 三持常规槽（weapon3）应隐藏
    expect(wrapper.find('.equipment-slot[data-slot^="weapon:3:"]').exists(), "无三持时不应渲染 武3常规槽").toBe(false);
    // 第三武器槽应显示
    expect(slotOf(wrapper, "thirdWeapon:1").exists()).toBe(true);
    expect(slotOf(wrapper, "mountOffense").exists()).toBe(true);
    expect(slotOf(wrapper, "mountDefense").exists()).toBe(true);
  });

  it("装备了双槽坐骑（mountDual）时合并为单个坐骑槽，不重复显示", () => {
    const dual = card("card:dual");
    const wrapper = mount(GamePlayerPanel, { props: { player: player({ equipmentSlots: { ...fullEquipment, mountOffense: dual, mountDefense: null, mountDual: true } }), active: false, local: false } });
    expect(slotOf(wrapper, "mountDual").exists()).toBe(true);
    expect(wrapper.find('.equipment-slot[data-slot="mountOffense"], .equipment-slot[data-slot="mountDefense"]').exists(), "双槽坐骑合并后不应再有 攻骑/防骑 槽").toBe(false);
  });

  it("攻骑与防骑装备了不同的坐骑时分开显示两个槽", () => {
    const off = card("card:off"), def = card("card:def");
    const wrapper = mount(GamePlayerPanel, { props: { player: player({ equipmentSlots: { ...fullEquipment, mountOffense: off, mountDefense: def, mountDual: false } }), active: false, local: false } });
    expect(slotOf(wrapper, "mountOffense").exists()).toBe(true);
    expect(slotOf(wrapper, "mountDefense").exists()).toBe(true);
    expect(wrapper.find('.equipment-slot[data-slot="mountDual"]').exists(), "不同坐骑不应合并为单个坐骑槽").toBe(false);
  });

  it("装备槽强制 2 行：第一行 武1/武2/三武/坐骑，第二行 防具/赋1/赋2/赋3/boss", () => {
    const wrapper = mount(GamePlayerPanel, { props: { player: player({ equipmentSlots: { ...fullEquipment, talents: [card("card:t1"), card("card:t2"), card("card:t3")] } }), active: false, local: false } });
    const rows = wrapper.findAll(".equipment-row");
    expect(rows.length, "装备区应为固定 2 行").toBe(2);
    const slotsInRow = (rowIndex: number) => rows[rowIndex]!.findAll(".equipment-slot").map((s) => s.attributes("data-slot"));
    // 第一行：武器与坐骑
    expect(slotsInRow(0), "第一行槽位顺序应正确").toEqual(["weapon:1:1", "weapon:2:1", "thirdWeapon:1", "mountOffense", "mountDefense"]);
    // 第二行：防具 + 3 个天赋 + boss
    expect(slotsInRow(1), "第二行槽位顺序应正确").toEqual(["armor", "talent:0:1", "talent:1:1", "talent:2:1", "boss"]);
  });
});

describe("GamePlayerPanel 角色卡信息行（task21）", () => {
  it("删除 手牌x/inplay 元信息行", () => {
    const wrapper = mount(GamePlayerPanel, { props: { player: player(), active: false, local: false } });
    expect(wrapper.find(".game-player__meta").exists(), "不应再渲染 手牌x/inplay 元信息行").toBe(false);
  });

  it("HP/护盾后显示蓝色同样式 cards x/y（当前数量/上限）", () => {
    const wrapper = mount(GamePlayerPanel, { props: { player: player(), active: false, local: false } });
    const cards = wrapper.find(".game-player__vitals .cards");
    expect(cards.exists(), "应存在 cards x/y 元素").toBe(true);
    expect(cards.text()).toBe("cards 4/4");
    const cs = getComputedStyle(cards.element as HTMLElement);
    expect(cs.color, "cards 应为蓝色文字").toBe("rgb(127, 196, 232)");
  });

  it("在线显示绿色无框小字 online，离线显示灰色 offline", () => {
    const online = mount(GamePlayerPanel, { props: { player: player(), active: false, local: false } });
    const onConn = online.find(".game-player__vitals .conn");
    expect(onConn.exists(), "应存在 online/offline 连接小字").toBe(true);
    expect(onConn.text()).toBe("online");
    const onCs = getComputedStyle(onConn.element as HTMLElement);
    expect(onCs.color, "online 应为绿色").toBe("rgb(111, 221, 160)");
    expect(onCs.borderColor === "rgb(111, 221, 160)", "online 应为无框（border 颜色不随状态）").toBe(false);

    const offline = mount(GamePlayerPanel, { props: { player: player({ connected: false }), active: false, local: false } });
    const offConn = offline.find(".game-player__vitals .conn");
    expect(offConn.text()).toBe("offline");
    expect(getComputedStyle(offConn.element as HTMLElement).color, "offline 应为灰色").toBe("rgb(111, 135, 149)");
  });
});
