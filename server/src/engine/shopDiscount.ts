import type { LoadedRuleset } from "../ruleset/types.js";
import { addDrawCountModifierInTransaction } from "./drawCount.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { EngineTransaction } from "./transaction.js";

interface Rule {
  familyId: string;
  cooldown: { value: number };
  triggers: Array<{
    effects: Array<{
      op: string;
      params?: { delta?: number; readyAfterOwnerRoundCount?: number };
    }>;
  }>;
}
interface Document {
  effectFamilies: Rule[];
}
const TALENT = "talent.shop_discount",
  COOLDOWN = "talent.shopDiscount.cooldownOwnerTurns";

function ruleFor(ruleset: LoadedRuleset) {
  const document = ruleset.documents.get("nonboss-rules.json") as Document,
    rule = document.effectFamilies.find((item) => item.familyId === TALENT),
    effects = rule?.triggers[0]?.effects ?? [],
    delta = effects.find((effect) => effect.op === "modifyEvent")?.params
      ?.delta,
    readyAfter = effects.find((effect) => effect.op === "startCooldown")?.params
      ?.readyAfterOwnerRoundCount;
  if (!rule || !Number.isInteger(delta) || !Number.isInteger(readyAfter))
    throw new Error("SHOP_DISCOUNT_RULE_INVALID");
  return { delta: delta!, readyAfter: readyAfter! };
}

function source(
  state: AuthoritativeGameState,
  seat: Seat,
): { effective: boolean; sourceRef: string | null } {
  const player = state.players.find((item) => item.seat === seat)!;
  if (player.initialTalentIds.includes(TALENT))
    return { effective: true, sourceRef: `character:${seat}` };
  if (
    player.markers.equipmentEffectsDisabled === true ||
    player.statuses.some(
      (status) => status.statusId === "status.equipmentDisabled",
    )
  )
    return { effective: false, sourceRef: null };
  const ref = state.zones[`talent:${seat}`]?.orderedCardRefs.find(
    (cardRef) => state.cards[cardRef]?.templateId === TALENT,
  );
  return { effective: Boolean(ref), sourceRef: ref ?? null };
}

export function tickShopDiscountCooldownAtPrepare(
  tx: EngineTransaction<AuthoritativeGameState>,
  seat: Seat,
): void {
  const player = tx.draft.players.find((item) => item.seat === seat)!,
    before = Number(player.markers[COOLDOWN] ?? 0);
  if (before <= 0) return;
  const after = before - 1;
  if (after > 0) player.markers[COOLDOWN] = after;
  else delete player.markers[COOLDOWN];
  tx.emit("cooldown.ticked", {
    seat,
    abilityId: TALENT,
    from: before,
    to: after,
  });
}

export function applyShopDiscountAtDraw(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  seat: Seat,
): void {
  const player = tx.draft.players.find((item) => item.seat === seat)!,
    talent = source(tx.draft, seat);
  if (!talent.effective || Number(player.markers[COOLDOWN] ?? 0) > 0) return;
  const rule = ruleFor(ruleset);
  addDrawCountModifierInTransaction(tx, {
    seat,
    modifierId: `talent.shopDiscount:${tx.draft.round}:${seat}`,
    sourceRef: talent.sourceRef,
    delta: rule.delta,
    remainingAffectedDraws: 1,
  });
  player.markers[COOLDOWN] = rule.readyAfter;
  tx.emit("cooldown.started", {
    seat,
    abilityId: TALENT,
    ownerTurnsUntilReady: rule.readyAfter,
  });
}
