import type {LoadedRuleset} from "../ruleset/types.js";
import type {JsonValue} from "../engine/types.js";

// 卡牌简洁摘要（服务端生成，客户端 cardSummary 优先使用）。风格对齐操作提示词 4.0：
// "射程2 · 伤害2" 级简短；动态值（耐久/蓄力）来自卡牌 runtime，随对局状态变化。
// 未覆盖的卡牌返回空串，客户端回退本地静态描述（cardDescriptions）。

type Runtime = Record<string, JsonValue>;
interface WeaponTemplate {
  weaponId: string;
  canonicalRule?: string;
  attackModes?: Array<{
    modeId: string;
    range?: number | "unlimited";
    attackTypes?: string[];
    damageSegments?: Array<{
      amount?: number;
      repeat?: number;
      element?: string;
      isAdditional?: boolean;
    }>;
    costs?: { killCards?: number };
  }>;
  charge?: unknown;
}
const attackTypeText: Record<string, string> = { ranged: "远程", melee: "近战", laser: "激光", field: "场地" };
const elementText: Record<string, string> = { fire: "火", poison: "毒", electric: "感电" };
let weaponTemplates: Map<string, WeaponTemplate> | null = null;
const weaponMap = (ruleset: LoadedRuleset): Map<string, WeaponTemplate> => {
  if (!weaponTemplates) {
    const doc = ruleset.documents.get("weapon-rules.json") as { templates?: WeaponTemplate[] } | undefined;
    weaponTemplates = new Map((doc?.templates ?? []).map((t) => [t.weaponId, t]));
  }
  return weaponTemplates;
};
const segmentText = (seg: { amount?: number; repeat?: number; element?: string; isAdditional?: boolean }): string => {
  const amount = Number(seg.amount ?? 0);
  const repeat = Number(seg.repeat ?? 1);
  const element = seg.element ? elementText[seg.element] : undefined;
  return `${amount}${repeat > 1 ? `×${repeat}` : ""}${element ? element : ""}`;
};
function weaponSummary(ruleset: LoadedRuleset, weaponId: string, runtime: Runtime): string {
  const tpl = weaponMap(ruleset).get(weaponId);
  if (!tpl) return "";
  const durability = Number(runtime.durabilityCurrent ?? runtime.durability ?? 0);
  if (weaponId === "weapon.w61" && durability > 0) return `射程2 · 伤害1×${durability}（扳手耐久）`;
  const mode = tpl.attackModes?.[0];
  if (!mode) return "";
  const base = (mode.damageSegments ?? []).filter((seg) => !seg.isAdditional);
  if (!base.length) return "";
  const type = mode.attackTypes?.[0] ? (attackTypeText[mode.attackTypes[0]] ?? "") : "";
  const range = typeof mode.range === "number" ? String(mode.range) : mode.range === "unlimited" ? "不限" : "";
  const parts: string[] = [];
  if (type) parts.push(type + range);
  parts.push(`伤害${base.map(segmentText).join("+")}`);
  const charge = Object.entries(runtime).find(([k, v]) => k.toLowerCase().includes("charge") && typeof v === "number")?.[1];
  if (typeof charge === "number") parts.push(`蓄力${charge}`);
  return parts.join(" · ");
}
function supportSummary(templateId: string): string {
  if (templateId.startsWith("basic.potion.")) return "回复2血";
  if (templateId.startsWith("basic.horn.")) return "回复1血，或本回合下一次武器攻击必暴";
  if (templateId.startsWith("basic.dodge.")) return "抵消一次攻击的全部伤害段";
  if (templateId.startsWith("basic.kill.")) return "攻击需支付1张【杀】";
  if (templateId.startsWith("basic.coin.")) return "普通金币";
  return "";
}
export function buildCardSummary(ruleset: LoadedRuleset, templateId: string, runtime: Runtime): string {
  if (templateId.startsWith("weapon.")) return weaponSummary(ruleset, templateId, runtime);
  return supportSummary(templateId);
}
