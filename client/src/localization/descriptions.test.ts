import { describe, expect, it } from "vitest";
import { describeAbility, describeCard, describeCharacter, cardSummary, abilityDisplayName } from "./descriptions";
import cardsJson from "../../../rulesets/v1.3.4/cards.json" with { type: "json" };
import charactersJson from "../../../rulesets/v1.3.4/characters.json" with { type: "json" };
import characterRulesJson from "../../../rulesets/v1.3.4/character-rules.json" with { type: "json" };

describe("descriptions 本地化配置", () => {
  it("典型 cardId 均能解析到非空中文描述", () => {
    const cases = [
      "basic.kill.white", "basic.dodge.green", "basic.potion.blue", "basic.horn.orange", "basic.coin.white",
      "weapon.w01", "weapon.w16", "weapon.w66",
      "armor.a02", "armor.a09",
      "talent.blue_shield", "talent.triple_wield",
      "mount.m01", "mount.m11",
      "statue.wizard.red", "statue.engineer.white",
      "special.sp03", "special.sp10",
      "boss.purple_lord", "boss.valkyrie",
    ];
    for (const cardId of cases) {
      const summary = describeCard(cardId);
      expect(typeof summary, `cardId=${cardId}`).toBe("string");
      expect(summary.length, `cardId=${cardId} 描述为空`).toBeGreaterThan(0);
      expect(summary, `cardId=${cardId} 不应输出占位`).not.toMatch(/暂未收录/);
    }
  });

  it("无颜色差异的模板前缀回退正确", () => {
    // 雕像、基础牌不同颜色共用同一描述
    const base = describeCard("statue.wizard.white");
    for (const color of ["green", "blue", "orange", "red"]) {
      expect(describeCard(`statue.wizard.${color}`)).toBe(base);
    }
    for (const color of ["green", "blue", "orange", "red"]) {
      expect(describeCard(`basic.kill.${color}`)).toBe(describeCard("basic.kill.white"));
    }
  });

  it("角色与技能均能解析到非空中文描述", () => {
    expect(describeCharacter("character.knight")).toMatch(/骑士/);
    expect(describeCharacter("character.shaman").length).toBeGreaterThan(0);
    expect(describeAbility("talent.blue_shield").length).toBeGreaterThan(0);
    expect(describeAbility("skill.shaman.defy_fate").length).toBeGreaterThan(0);
    // 初始天赋显示名
    expect(abilityDisplayName("talent.blue_shield")).toBe("蓝盾");
    expect(abilityDisplayName("skill.knight.instinct")).toBe("骑士本能");
  });

  it("未知 key 安全降级不抛错", () => {
    expect(describeCard("weapon.zzz")).toMatch(/暂未收录/);
    expect(describeCharacter("character.zzz")).toMatch(/暂未收录/);
    expect(describeAbility("skill.zzz")).toMatch(/暂未收录/);
  });

  it("cardSummary 优先使用服务端 summary，为空时才回退本地", () => {
    expect(cardSummary("basic.kill.white", "服务端描述")).toBe("服务端描述");
    expect(cardSummary("basic.kill.white", "")).toBe(describeCard("basic.kill.white"));
  });

  it("覆盖冻结规则包全部卡牌/角色/技能", () => {
    const cards = (cardsJson as { items: { cardId: string }[] }).items;
    const missingCards = cards.filter((c) => describeCard(c.cardId) === "暂未收录该牌的规则说明。").map((c) => c.cardId);
    expect(missingCards, `缺失卡牌描述: ${missingCards.join(", ")}`).toEqual([]);

    const characters = (charactersJson as { items: { characterId: string }[] }).items;
    const missingChars = characters.filter((c) => describeCharacter(c.characterId).includes("暂未收录")).map((c) => c.characterId);
    expect(missingChars, `缺失角色描述: ${missingChars.join(", ")}`).toEqual([]);

    const abilities = (characterRulesJson as { abilities: { abilityId: string }[] }).abilities;
    const missingAbilities = abilities.filter((a) => describeAbility(a.abilityId).includes("暂未收录")).map((a) => a.abilityId);
    expect(missingAbilities, `缺失技能描述: ${missingAbilities.join(", ")}`).toEqual([]);
  });
});
