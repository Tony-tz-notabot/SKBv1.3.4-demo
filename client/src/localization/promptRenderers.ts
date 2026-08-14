// 操作提示词 L1 渲染：按窗口 kind 把服务端 promptData 拼成带 token 着色的句子。
// 六角色（主语/宾语/手段/报价/效果/后果）见 docs/整理/128 §4.0；配色见 §4.0.1。
// 无 promptData 时回退静态 FALLBACK_HINTS。

import { characterCandidate } from "./characterCatalog";
import { abilityDisplayName } from "./descriptions";
import { describeCard } from "./cardDescriptions";

// 卡牌 ID → 简洁名（取本地描述 "名：效果" 的冒号前缀并去括号）。
export const cardNameById = (id: string): string => {
  const name = describeCard(id).split("：")[0] ?? id;
  return name.replace(/（[^）]*）.*$/, "") || id;
};

export type TokenCls =
  | "rel-self"
  | "rel-ally"
  | "rel-enemy"
  | "card-white"
  | "card-green"
  | "card-blue"
  | "card-orange"
  | "card-red"
  | "sem-normal"
  | "sem-shield"
  | "sem-hp"
  | "sem-heal"
  | "sem-cost"
  | "sem-fire"
  | "sem-poison"
  | "sem-electric"
  | "sem-frozen"
  | "sem-extra"
  | null;

export interface PromptSegment { text: string; cls: TokenCls; }
export type PromptData = Record<string, unknown>;

const seg = (text: string, cls: TokenCls = null): PromptSegment => ({ text, cls });
const attackTypeText: Record<string, string> = { ranged: "远程", melee: "近战", laser: "激光", field: "场地" };
const elementText: Record<string, string> = { fire: "火", poison: "毒", electric: "感电" };
const elementCls: Record<string, TokenCls> = { fire: "sem-fire", poison: "sem-poison", electric: "sem-electric" };
const damageCls: Record<string, TokenCls> = { shield: "sem-shield", hp: "sem-hp" };
const cardClsByColor: Record<string, TokenCls> = { white: "card-white", green: "card-green", blue: "card-blue", orange: "card-orange", red: "card-red" };

export const cardCls = (color: string | undefined | null): TokenCls => (color ? cardClsByColor[color] ?? null : null);

interface RenderPlayer { seat: number; team: string; characterId: string | null | undefined; }
export interface PromptRenderContext {
  viewerSeat: number | null;
  viewerTeam: string | null;
  players: RenderPlayer[];
}

const playerOf = (ctx: PromptRenderContext, seat: number) => ctx.players.find((p) => p.seat === seat);
export function characterName(ctx: PromptRenderContext, seat: number): string {
  const p = playerOf(ctx, seat);
  const c = p ? characterCandidate(p.characterId) : null;
  return c?.displayName ?? p?.characterId ?? `${seat}号玩家`;
}
export function relationshipCls(ctx: PromptRenderContext, seat: number): TokenCls {
  if (seat === ctx.viewerSeat) return "rel-self";
  const p = playerOf(ctx, seat);
  if (!p || !ctx.viewerTeam) return null;
  return p.team === ctx.viewerTeam ? "rel-ally" : "rel-enemy";
}

function damageSegmentsText(segs: unknown[]): PromptSegment[] {
  const out: PromptSegment[] = [];
  segs.forEach((raw, i) => {
    const s = (raw ?? {}) as Record<string, unknown>;
    if (i > 0) out.push(seg("+"));
    const amount = Number(s.amount ?? 0);
    const repeat = Number(s.repeat ?? 1);
    const el = typeof s.element === "string" ? s.element : "none";
    const dt = typeof s.damageType === "string" ? s.damageType : "normal";
    const numCls = damageCls[dt] ?? "sem-normal";
    if (repeat > 1) out.push(seg(String(amount), numCls), seg("×"), seg(String(repeat), numCls));
    else out.push(seg(String(amount), numCls));
    if (el !== "none" && elementText[el]) out.push(seg(elementText[el], elementCls[el] ?? "sem-extra"));
  });
  return out;
}

function attackResponsePrompt(data: PromptData | null, ctx: PromptRenderContext): PromptSegment[] {
  const attackerSeat = Number(data?.attackerSeat ?? 0);
  if (!(attackerSeat >= 1 && attackerSeat <= 4)) return [seg(FALLBACK_HINTS.attackResponse ?? "攻击响应")];
  const out: PromptSegment[] = [seg(characterName(ctx, attackerSeat), relationshipCls(ctx, attackerSeat))];
  if (typeof data?.weaponLabel === "string" && data.weaponLabel)
    out.push(seg(`用【${data.weaponLabel}】`, cardCls(typeof data.weaponColor === "string" ? data.weaponColor : undefined)));
  out.push(seg("攻击"), seg("你", "rel-self"));
  const type = Array.isArray(data?.attackTypes) && typeof data.attackTypes[0] === "string" ? attackTypeText[data.attackTypes[0]] : "";
  if (type) {
    out.push(seg("："), seg(type + (typeof data?.range === "number" ? data.range : "")));
    if (Array.isArray(data?.damageSegments) && data.damageSegments.length) {
      out.push(seg(" · 伤害"));
      out.push(...damageSegmentsText(data.damageSegments as unknown[]));
    }
  }
  out.push(seg("；不响应将承受上述伤害"));
  return out;
}

function dyingPrompt(data: PromptData | null, ctx: PromptRenderContext): PromptSegment[] {
  const dyingSeat = Number(data?.dyingSeat ?? 0);
  if (!(dyingSeat >= 1 && dyingSeat <= 4)) return [seg(FALLBACK_HINTS.dyingRescue ?? "濒死救援")];
  const out: PromptSegment[] = [seg(characterName(ctx, dyingSeat), relationshipCls(ctx, dyingSeat)), seg("濒死")];
  if (typeof data?.dyingHp === "number") out.push(seg(`(${data.dyingHp}/${maxHpOf(ctx, dyingSeat)})`));
  const src = Number(data?.damageSourceSeat ?? 0);
  if (src >= 1 && src <= 4) out.push(seg("，来源"), seg(characterName(ctx, src), relationshipCls(ctx, src)));
  out.push(seg("；可用药水/号角/技能救援，放弃→淘汰"));
  return out;
}
function maxHpOf(ctx: PromptRenderContext, seat: number): number {
  const p = playerOf(ctx, seat);
  const c = p ? characterCandidate(p.characterId) : null;
  return c?.initialHp ?? 0;
}

function colorsPrompt(data: PromptData | null, label: string, colorText: Record<string, string>): PromptSegment[] {
  const colors = Array.isArray(data?.colors) ? data.colors.filter((c): c is string => typeof c === "string") : [];
  if (!colors.length) return [seg(label)];
  const out: PromptSegment[] = [seg(label), seg("：")];
  colors.forEach((c, i) => {
    if (i > 0) out.push(seg(" / "));
    out.push(seg(colorText[c] ?? c, "sem-frozen"));
  });
  return out;
}
const colorNames: Record<string, string> = { white: "白", red: "红", orange: "橙", blue: "蓝", green: "绿", none: "无色" };

function judgmentDesignationPrompt(data: PromptData | null): PromptSegment[] {
  return colorsPrompt(data, "指定判定颜色", colorNames);
}
function preJudgmentPrompt(data: PromptData | null): PromptSegment[] {
  const base = colorsPrompt(data, "即将判定", colorNames);
  const purpose = typeof data?.purpose === "string" ? data.purpose : "";
  if (purpose) base.push(seg(`（${purpose}）`));
  base.push(seg("；可逆天改命指定结果或放弃随机判定"));
  return base;
}
function judgmentInterventionPrompt(data: PromptData | null): PromptSegment[] {
  const replaced = data?.replaced === true;
  return [seg(replaced ? "判定已被替换" : "判定干预：可替换判定牌或放弃（放弃=随机判定）")];
}
function discardPrompt(data: PromptData | null): PromptSegment[] {
  const required = Number(data?.requiredCount ?? 0);
  const hand = Number(data?.handCount ?? 0);
  const limit = Number(data?.handLimit ?? 0);
  return [seg(required > 0 ? `手牌${hand}/${limit}，需弃${required}张` : `手牌${hand}/${limit}，未超限可结束`)];
}

// 静态兜底：无 promptData 时使用（与 GameView.vue 既有表一致）。
export const FALLBACK_HINTS: Record<string, string> = {
  playPhaseAction: "你的出牌阶段：可发动攻击、装备武器、使用手牌，或结束阶段",
  discardPhaseAction: "你的弃牌阶段：手牌超限需弃置，否则直接结束",
  attackResponse: "你正被攻击：可出【闪】、防具或技能响应，否则放弃",
  dyingRescue: "你处于濒死：可用药水、号角或技能救援，否则将被淘汰",
  judgmentDesignation: "指定判定：可指定颜色，或放弃交给随机判定",
  judgmentIntervention: "判定干预：当前玩家可替换判定牌，或放弃",
  preJudgment: "判定确认：确认开始判定",
  optionalTrigger: "可选触发：可发动效果（放弃则不发动）",
  triggerOrdering: "触发排序：选择效果的结算顺序",
  berserkerRage: "狂战宣告：选择少摸牌数（1/2 使下个攻击必暴击）",
  c6LaserSweepRequest: "C6H8O6：选择要求其他玩家打出的牌色",
  c6FocusedBombardmentRequest: "C6H8O6：选择要求目标打出的牌色",
  criticalPenetration: "暴击穿透：选择追击目标与【杀】",
  crystalCrabActivePincer: "水晶巨蟹主动钳：可选攻击一个目标",
  darkKnightFinalStrike: "暗黑大骑士最后一击：逐次选择攻击目标",
  divineBarrierDamage: "神圣屏障：可支付两张蓝牌免疫本次伤害",
  engineerMechChoice: "工程师机甲：选择要进入的机甲",
  extraGemDeathTransfer: "额外宝石：濒死结算，选择交付的手牌",
  extraGemDyingResult: "额外宝石：选择交付的手牌",
  foresightDrawChoice: "未卜先知：从展示牌中选择要摸的牌（其余弃置）",
  goldenMaskTarget: "金面猴王：选择攻击目标",
  internetAddictionDodgeRequest: "网瘾：选择是否出【闪】响应",
  minerDigAtPlayEnd: "矿工遁地：选择拆牌目标",
  minerNaturalExitTarget: "矿工遁地：选择自然退出攻击目标",
  minerSourceDismantle: "矿工：选择要拆的伤害来源牌",
  owlCounterattack: "枭首者猫头鹰：可选发起反击",
  purpleLordHeroBlade: "魂刀·英刃：可选攻击一个目标",
  qiBallDismantle: "气功波：选择要拆除的卡牌",
  reforgeFurnaceSelection: "重铸熔炉：从展示的武器中选择一把",
  sheepPhaseOneDodgeRequest: "羊叫兽：选择是否出【闪】响应",
  superBabyDodgeRequest: "超级大宝贝儿：选择是否出【闪】响应",
  temporaryCoinImmediateUse: "临时金币：立即使用或放弃",
  trapBombDetonation: "引爆炸弹：选择引爆或放弃",
  triggerCardSelection: "触发选牌：选择目标卡牌",
  valkyrieBossResponse: "瓦尔基里：可响应复制对方 BOSS",
  weaponParticleEagleFollowUp: "粒子之鹰追击：选择追击目标或放弃",
  weaponW61Choice: "扳手：选择拆除目标或改为伤害",
  wizardSpellStrike: "法师法术打击：弃一张手牌触发效果",
  redLordSealingHammer: "封灵战锤：选择近战/激光目标",
  statueResolutionChoice: "雕像效果：选择目标执行雕像效果",
  statueCardSelection: "雕像：从目标处选择一张卡牌",
  statuePaladinResponse: "圣骑士雕像：可阻止其他雕像效果",
  statuePriestTake: "牧师雕像：选择是否拿取展示牌",
  statueKnightDuel: "骑士雕像：交替出【杀】决斗",
  statueKnightWeapon: "骑士雕像：选择决斗胜利后的武器",
  demolitionOptionalDiscard: "拆迁大队：可选择弃置一把武器",
  demolitionWeaponOverflow: "拆迁大队：武器超限需选择弃置",
  initialRedraw: "开局重摸：选择是否整手弃 4 摸 4",
};

export function renderPromptSegments(prompt: { kind: string; promptData?: unknown } | null, ctx: PromptRenderContext): PromptSegment[] {
  if (!prompt) return [seg("等待服务器推进")];
  const data = (prompt.promptData ?? null) as PromptData | null;
  const fb = (k: string) => FALLBACK_HINTS[k] ?? "请完成下方操作窗口";
  const seat = (n: unknown): number => Number(n ?? 0);
  const char = (n: number) => seg(characterName(ctx, n), relationshipCls(ctx, n));
  const seatText = (seats: unknown): string =>
    Array.isArray(seats)
      ? seats.filter((s): s is number => typeof s === "number").map((n) => characterName(ctx, n)).join("/") || "目标"
      : "目标";
  switch (prompt.kind) {
    case "attackResponse": return attackResponsePrompt(data, ctx);
    case "dyingRescue": return dyingPrompt(data, ctx);
    case "judgmentDesignation": return judgmentDesignationPrompt(data);
    case "preJudgment": return preJudgmentPrompt(data);
    case "judgmentIntervention": return judgmentInterventionPrompt(data);
    case "discardPhaseAction": return discardPrompt(data);
    case "optionalTrigger": {
      const effectId = typeof data?.effectId === "string" ? data.effectId : "";
      return effectId ? [seg(`触发【${abilityDisplayName(effectId)}】；发动或放弃（放弃则不发动）`)] : [seg(fb("optionalTrigger"))];
    }
    case "triggerOrdering": {
      const effects = Array.isArray(data?.effects) ? data.effects.filter((e): e is string => typeof e === "string") : [];
      if (!effects.length) return [seg(fb("triggerOrdering"))];
      const out: PromptSegment[] = [seg("触发排序：")];
      effects.forEach((e, i) => {
        if (i > 0) out.push(seg(" > "));
        out.push(seg(abilityDisplayName(e), "sem-extra"));
      });
      out.push(seg("；按序结算"));
      return out;
    }
    case "c6LaserSweepRequest": {
      const family = data?.family === "dodge" ? "【闪】" : data?.family === "kill" ? "【杀】" : "牌";
      return [seg(`C6激光扫射：全员打出${family}，未打出者受伤害（当前待响应${Number(data?.pendingCount ?? 0)}人）`)];
    }
    case "crystalCrabActivePincer": return [seg("晶蟹钳（主动）：可选攻击一个目标，命中判定白/蓝冰冻")];
    case "engineerMechChoice": {
      const options = Array.isArray(data?.options) ? data.options.filter((o): o is string => typeof o === "string") : [];
      return options.length ? [seg(`选择机甲：${options.join(" / ")}`)] : [seg(fb("engineerMechChoice"))];
    }
    case "extraGemDeathTransfer": {
      const n = seat(data?.dyingSeat);
      return n >= 1 && n <= 4
        ? [seg("额外宝石：濒死者"), char(n), seg("死亡，将全部手牌交付给一个目标")]
        : [seg(fb("extraGemDeathTransfer"))];
    }
    case "minerNaturalExitTarget": return [seg("矿工遁地自然退出：对", null), seg(seatText(data?.targetSeats)), seg("造成1点场地伤害（选择目标）")];
    case "owlCounterattack": {
      const n = seat(data?.attackerSeat);
      const out: PromptSegment[] = [seg("猫头鹰反击：")];
      if (n >= 1 && n <= 4) out.push(char(n));
      out.push(seg("对你造成伤害，可发起距离不限的吹箭反击"));
      return out;
    }
    case "purpleLordHeroBlade": return [seg("魂刀·英刃：可选攻击一个目标（近战4）")];
    case "redLordSealingHammer": {
      const melee = Array.isArray(data?.meleeTargetSeats) ? data.meleeTargetSeats.length : 0;
      const laser = Array.isArray(data?.laserTargetSeats) ? data.laserTargetSeats.length : 0;
      return [seg(`封灵战锤：近战3 / 激光3 独立选目标（近战${melee}候选 · 激光${laser}候选）`)];
    }
    case "sheepPhaseOneDodgeRequest": return [seg("羊叫兽阶段一：出【闪】，未出者受感电2且到回合结束不能出闪")];
    case "superBabyDodgeRequest": return [seg("超级大宝贝儿：出【闪】，未出者受3血量伤害")];
    case "temporaryCoinImmediateUse": return [seg("临时金币：立即选择合法用途或放弃（结算/放弃后消失）")];
    case "valkyrieBossResponse": {
      const tpl = typeof data?.templateId === "string" ? data.templateId : "";
      return [seg(`瓦尔基里：可响应复制对方BOSS【${tpl ? cardNameById(tpl) : ""}】`)];
    }
    case "weaponParticleEagleFollowUp": return [seg("粒子之鹰追击：可对射程内另一目标追击一次（不再连锁）")];
    case "wizardSpellStrike": {
      const n = seat(data?.attackerSeat);
      return n >= 1 && n <= 4
        ? [seg("法术打击："), char(n), seg("的【杀】命中，可弃1张手牌判定追加效果")]
        : [seg(fb("wizardSpellStrike"))];
    }
    case "statuePaladinResponse": return [seg("圣骑士雕像：可打出圣骑士雕像阻止本次雕像效果（后进先出）")];
    case "statueResolutionChoice": {
      const fam = typeof data?.statueFamily === "string" ? data.statueFamily : "";
      return fam ? [seg(`雕像效果【${cardNameById(fam)}】：选择目标执行`) ] : [seg(fb("statueResolutionChoice"))];
    }
    case "demolitionOptionalDiscard": return [seg(`拆迁大队：可弃至多1把武器（当前可弃${Number(data?.weaponCount ?? 0)}把）`)];
    case "playPhaseAction": {
      const hand = Number(data?.handCount ?? 0);
      const limit = Number(data?.handLimit ?? 0);
      return [seg(`你的出牌阶段（手牌${hand}/${limit}）：可攻击、装备、使用手牌，或结束`)];
    }
    default: return [seg(fb(prompt.kind))];
  }
}

// L2 报价按钮的效果摘要：结构化伤害段（着色）或来源卡摘要 + 费用。数据来自 offer.preview。
export function offerPreviewSegments(preview: { damageStructure?: unknown; costSummary?: string | null } | null | undefined, cardSummary?: string | null): PromptSegment[] {
  if (!preview) return [];
  const out: PromptSegment[] = [];
  if (Array.isArray(preview.damageStructure) && preview.damageStructure.length) {
    out.push(seg("伤害"), ...damageSegmentsText(preview.damageStructure));
  } else if (cardSummary) {
    out.push(seg(cardSummary));
  }
  if (preview.costSummary) {
    if (out.length) out.push(seg(" · "));
    out.push(seg(preview.costSummary, "sem-cost"));
  }
  return out;
}
