// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import CardDetailDrawer from "./CardDetailDrawer.vue";
import CharacterDetailDrawer from "./CharacterDetailDrawer.vue";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("CardDetailDrawer 描述渲染", () => {
  const card = (overrides: Record<string, unknown> = {}) => ({
    ref: "card:1",
    templateId: "weapon.w16",
    displayName: "猎人弓",
    category: "weapon" as const,
    printedColor: "blue" as const,
    coreStats: [],
    summary: "",
    resourceKey: "card.weapon.w16",
    badges: [],
    state: { selected: false, effective: true },
    detailAvailable: true,
    ...overrides,
  });

  it("summary 为空时显示本地化描述", () => {
    mount(CardDetailDrawer, { props: { card: card() } });
    const summary = document.body.querySelector(".card-detail-summary")?.textContent ?? "";
    expect(summary).toContain("猎人弓");
    expect(summary).toContain("判定蓝");
  });

  it("服务端 summary 非空时优先显示服务端描述", () => {
    mount(CardDetailDrawer, { props: { card: card({ summary: "服务端下发描述" }) } });
    expect(document.body.querySelector(".card-detail-summary")?.textContent).toBe("服务端下发描述");
  });

  it("无卡片时不渲染", () => {
    mount(CardDetailDrawer, { props: { card: null } });
    expect(document.body.querySelector(".detail-drawer")).toBe(null);
  });
});

describe("CharacterDetailDrawer 描述渲染", () => {
  const candidate = (overrides: Record<string, unknown> = {}) => ({
    characterId: "character.knight",
    displayName: "骑士",
    portraitResourceKey: "character.character.knight",
    initialHp: 6,
    initialShield: 5,
    initialTalentId: "talent.blue_shield",
    abilityIds: ["skill.knight.instinct"],
    difficulty: 1,
    ...overrides,
  });

  it("显示角色简介与技能中文名+描述", () => {
    mount(CharacterDetailDrawer, { props: { candidate: candidate() } });
    const text = document.body.querySelector(".detail-drawer")?.textContent ?? "";
    expect(text).toContain("均衡的近战角色");
    expect(text).toContain("蓝盾");
    expect(text).toContain("骑士本能");
    expect(text).toContain("转换为骑士雕像");
  });

  it("无候选时不渲染", () => {
    mount(CharacterDetailDrawer, { props: { candidate: null } });
    expect(document.body.querySelector(".detail-drawer")).toBe(null);
  });
});
