// 游戏内角色详情所需的展示元数据。键：characterId。
// 数据整理自 rulesets/v1.3.4/characters.json（服务端权威来源），仅作客户端展示。
// 服务端游戏投影只公开 characterId；displayName/初始天赋/技能列表在此补齐，供详情抽屉使用。
import type { CharacterCandidateView } from "@skb-protocol/room-protocol";

interface Entry {
  characterId: string;
  displayName: string;
  initialHp: number;
  initialShield: number;
  initialTalentId: string;
  abilityIds: string[];
}

const entries: Record<string, Entry> = {
  "character.knight": { characterId: "character.knight", displayName: "骑士", initialHp: 6, initialShield: 5, initialTalentId: "talent.blue_shield", abilityIds: ["skill.knight.instinct"] },
  "character.alchemist": { characterId: "character.alchemist", displayName: "炼金术士", initialHp: 6, initialShield: 5, initialTalentId: "talent.poison_shield", abilityIds: ["skill.alchemist.toxic_reagent"] },
  "character.headtaker": { characterId: "character.headtaker", displayName: "枭首者", initialHp: 4, initialShield: 7, initialTalentId: "talent.owl", abilityIds: ["skill.headtaker.spartan_kick"] },
  "character.werewolf": { characterId: "character.werewolf", displayName: "狼人", initialHp: 8, initialShield: 3, initialTalentId: "talent.blood_box", abilityIds: ["skill.werewolf.notebook"] },
  "character.paladin": { characterId: "character.paladin", displayName: "圣骑士", initialHp: 2, initialShield: 10, initialTalentId: "talent.shield_breaker", abilityIds: ["skill.paladin.divine_barrier"] },
  "character.elf": { characterId: "character.elf", displayName: "精灵", initialHp: 5, initialShield: 5, initialTalentId: "talent.charge_acceleration", abilityIds: ["skill.elf.gather_strength", "skill.elf.focused_shot", "skill.elf.focus_aim"] },
  "character.ranger": { characterId: "character.ranger", displayName: "游侠", initialHp: 6, initialShield: 4, initialTalentId: "talent.critical_penetration", abilityIds: ["skill.ranger.roll"] },
  "character.taoist": { characterId: "character.taoist", displayName: "道士", initialHp: 4, initialShield: 5, initialTalentId: "talent.spike_shield", abilityIds: ["skill.taoist.attack_reflection"] },
  "character.priest": { characterId: "character.priest", displayName: "牧师", initialHp: 5, initialShield: 5, initialTalentId: "talent.strong_potion", abilityIds: ["skill.priest.pray", "skill.priest.hope"] },
  "character.punching_bag": { characterId: "character.punching_bag", displayName: "拳击柱", initialHp: 10, initialShield: 0, initialTalentId: "talent.mana_siphon", abilityIds: ["skill.punching_bag.extra_health", "skill.punching_bag.inertial_counter"] },
  "character.interdimensional_traveler": { characterId: "character.interdimensional_traveler", displayName: "超界者", initialHp: 3, initialShield: 2, initialTalentId: "talent.parallel_traversal", abilityIds: ["skill.interdimensional_traveler.deadly_curse"] },
  "character.ancient_elementalist": { characterId: "character.ancient_elementalist", displayName: "古代元素使", initialHp: 5, initialShield: 6, initialTalentId: "talent.element_origin", abilityIds: ["skill.ancient_elementalist.element_satchel"] },
  "character.miner": { characterId: "character.miner", displayName: "矿工", initialHp: 4, initialShield: 4, initialTalentId: "talent.money_shield", abilityIds: ["skill.miner.dig_for_survival"] },
  "character.demonmancer": { characterId: "character.demonmancer", displayName: "恶魔术士", initialHp: 4, initialShield: 4, initialTalentId: "talent.hellfire", abilityIds: ["skill.demonmancer.demonic_nature"] },
  "character.necromancer": { characterId: "character.necromancer", displayName: "死灵法师", initialHp: 6, initialShield: 4, initialTalentId: "talent.soul_strike", abilityIds: ["skill.necromancer.mark"] },
  "character.robot": { characterId: "character.robot", displayName: "机器人", initialHp: 4, initialShield: 7, initialTalentId: "talent.electric_shield", abilityIds: ["skill.robot.energy_overload"] },
  "character.assassin": { characterId: "character.assassin", displayName: "刺客", initialHp: 5, initialShield: 6, initialTalentId: "talent.melee_counter", abilityIds: ["skill.assassin.creed_dodge", "skill.assassin.creed_kill"] },
  "character.wizard": { characterId: "character.wizard", displayName: "法师", initialHp: 5, initialShield: 5, initialTalentId: "talent.elemental_burst", abilityIds: ["skill.wizard.spell_strike"] },
  "character.qi_master": { characterId: "character.qi_master", displayName: "气宗", initialHp: 6, initialShield: 6, initialTalentId: "talent.qigong", abilityIds: ["skill.qi_master.qi_ball"] },
  "character.trap_master": { characterId: "character.trap_master", displayName: "陷阱大师", initialHp: 7, initialShield: 3, initialTalentId: "talent.bomb_siphon", abilityIds: ["skill.trap_master.bomber", "skill.trap_master.bomb_defense", "skill.trap_master.bomb_detonation"] },
  "character.engineer": { characterId: "character.engineer", displayName: "工程师", initialHp: 6, initialShield: 5, initialTalentId: "talent.fire_shield", abilityIds: ["skill.engineer.mech_maniac"] },
  "character.druid": { characterId: "character.druid", displayName: "德鲁伊", initialHp: 5, initialShield: 5, initialTalentId: "talent.adaptive_evolution", abilityIds: ["skill.druid.vine_entanglement"] },
  "character.berserker": { characterId: "character.berserker", displayName: "狂战士", initialHp: 8, initialShield: 4, initialTalentId: "talent.triple_wield", abilityIds: ["skill.berserker.rage"] },
  "character.shaman": { characterId: "character.shaman", displayName: "萨满", initialHp: 4, initialShield: 5, initialTalentId: "talent.foresight", abilityIds: ["skill.shaman.defy_fate"] },
  "character.general": { characterId: "character.general", displayName: "将军", initialHp: 11, initialShield: 1, initialTalentId: "talent.dog_squad", abilityIds: ["skill.general.mortar"] },
};

export function characterCandidate(characterId: string | null | undefined): CharacterCandidateView | null {
  const entry = characterId ? entries[characterId] : undefined;
  if (!entry) return null;
  return {
    characterId: entry.characterId,
    displayName: entry.displayName,
    portraitResourceKey: `character.${entry.characterId}`,
    initialHp: entry.initialHp,
    initialShield: entry.initialShield,
    initialTalentId: entry.initialTalentId,
    abilityIds: entry.abilityIds,
    difficulty: 1,
  };
}
