// 效果→颜色映射（132 §4.3：复用 128 操作提示词语义色系）。
export type EffectKind =
  | "hp"
  | "shield"
  | "heal"
  | "draw"
  | "fire"
  | "poison"
  | "electric"
  | "frozen"
  | "judgment"
  | "none"
  | "cost";

export const EFFECT_COLORS: Record<EffectKind, string> = {
  hp: "#ff8a7a",
  shield: "#9fb3bd",
  heal: "#6fdda0",
  draw: "#7fc4e8",
  fire: "#ffb37a",
  poison: "#3da86b",
  electric: "#ffd27b",
  frozen: "#7fc4e8",
  judgment: "#eaf6ff",
  none: "#eaf6ff",
  cost: "#efd27b",
};

export function effectColor(kind: EffectKind): string {
  return EFFECT_COLORS[kind] ?? EFFECT_COLORS.none;
}

/** 卡牌印刷色→颜色（判定成功边缘色光用，与 base.css card-* 一致）。 */
export const CARD_COLORS: Record<string, string> = {
  white: "#eef4f7",
  green: "#7fe0ae",
  blue: "#7fc4e8",
  orange: "#ffb37a",
  red: "#ff9aa8",
};

export function cardColor(printedColor: string): string {
  return CARD_COLORS[printedColor] ?? CARD_COLORS.white ?? "#eef4f7";
}

/** 从伤害段结果推断效果类型：扣血优先 hp，扣盾 shield，均无 none。 */
export function effectKindFromSegment(segment: { hpLost?: unknown; shieldLost?: unknown }): EffectKind {
  const hp = Number(segment.hpLost ?? 0);
  const shield = Number(segment.shieldLost ?? 0);
  if (hp > 0) return "hp";
  if (shield > 0) return "shield";
  return "none";
}
