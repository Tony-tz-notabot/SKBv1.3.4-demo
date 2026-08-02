import type { LoadedRuleset } from "../ruleset/types.js";
import { applyStatusInTransaction } from "./status.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import { moveCardInTransaction } from "./zoneMovement.js";
import { cleanupBossContributionsInTransaction } from "./bossContributions.js";
import { setEquippedTalentContributionsEnabled } from "./talentContributions.js";
import { openPurpleLordHeroBladeWindow } from "./purpleLord.js";
import { openRedLordHammerWindow } from "./redLordHammer.js";
import { openCrystalCrabActivePincerWindow } from "./crystalCrab.js";

interface Family {
  familyId: string;
  activation?: { point: string; immediate?: boolean };
  activeState?: Record<string, unknown>;
  specialLayer?: {
    layerId: string;
    initial: number;
    recoverable?: boolean;
  };
}
interface BossDoc {
  effectFamilies: Family[];
}
const family = (ruleset: LoadedRuleset, id: string) =>
  (ruleset.documents.get("boss-rules.json") as BossDoc).effectFamilies.find(
    (item) => item.familyId === id,
  );
const sourceList = (
  state: AuthoritativeGameState,
  seat: Seat,
  key: string,
): string[] => {
  const value = state.players.find((item) => item.seat === seat)!.markers[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
};
export function activateBossInTransaction(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  cardRef: string,
  point: string,
): void {
  const card = tx.draft.cards[cardRef],
    definition = card ? family(ruleset, card.templateId) : undefined;
  if (!card || !definition || card.runtime.active === true) return;
  const seat = card.controllerSeat;
  if (!seat) throw new Error("BOSS_CONTROLLER_MISSING");
  const player = tx.draft.players.find((item) => item.seat === seat)!,
    active = definition.activeState ?? {},
    iron = Number(active.ironShield ?? active.ironShieldDelta ?? 0);
  if (definition.specialLayer) {
    const amount = Number(definition.specialLayer.initial);
    if (!Number.isFinite(amount) || amount < 0)
      throw new Error("BOSS_SPECIAL_LAYER_INITIAL_INVALID");
    card.runtime.specialLayerId = definition.specialLayer.layerId;
    card.runtime.specialLayerRemaining = amount;
    card.runtime.specialLayerRecoverable =
      definition.specialLayer.recoverable === true;
    tx.emit("specialLayer.created", {
      seat,
      sourceRef: cardRef,
      layerId: definition.specialLayer.layerId,
      amount,
      recoverable: definition.specialLayer.recoverable === true,
    });
  }
  if (Number.isFinite(iron) && iron !== 0) {
    const before = player.ironShield;
    player.ironShield = Math.max(0, before + iron);
    const contribution = player.ironShield - before;
    card.runtime.ironShieldContribution = contribution;
    if (contribution !== 0)
      tx.emit("ironShield.modified", {
        seat,
        delta: contribution,
        sourceRef: cardRef,
      });
  }
  if (active.equipmentEffectsEnabled === false) {
    if (player.markers.equipmentEffectsDisabled !== true)
      setEquippedTalentContributionsEnabled(tx, seat, false);
    player.markers.equipmentDisableSources = [
      ...new Set([
        ...sourceList(tx.draft, seat, "equipmentDisableSources"),
        cardRef,
      ]),
    ];
    player.markers.equipmentEffectsDisabled = true;
  }
  if (active.controlImmunity) {
    player.markers.bossControlImmunitySources = [
      ...new Set([
        ...sourceList(tx.draft, seat, "bossControlImmunitySources"),
        cardRef,
      ]),
    ];
  }
  const statuses = Array.isArray(active.statuses)
    ? active.statuses.filter((item): item is string => typeof item === "string")
    : [];
  for (const statusId of statuses)
    applyStatusInTransaction(tx, ruleset, {
      ownerSeat: seat,
      statusId,
      sourceRef: cardRef,
      metadata: { bossSelfGranted: true },
    });
  const counters = Array.isArray(active.counters)
    ? (active.counters as Array<Record<string, unknown>>)
    : [];
  for (const counter of counters)
    card.runtime[String(counter.counterId)] = Number(counter.initial ?? 0);
  card.runtime.active = true;
  card.runtime.activationStatus = "active";
  card.runtime.activatedAtPoint = point;
  tx.emit("boss.activated", { seat, cardRef, bossId: card.templateId, point });
}
export function expireBossInTransaction(
  tx: EngineTransaction<AuthoritativeGameState>,
  cardRef: string,
  reason: string,
): void {
  const card = tx.draft.cards[cardRef];
  if (!card) return;
  cleanupBossContributionsInTransaction(tx, cardRef, reason);
  if (card.zoneRef.startsWith("boss:"))
    moveCardInTransaction(tx, {
      cardRef,
      toZoneRef: "discardPile",
      moveKind: "systemMove",
    });
}
export function activateImmediateBossIfNeeded(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  cardRef: string,
): void {
  const card = tx.draft.cards[cardRef]!,
    definition = family(ruleset, card.templateId);
  if (
    definition?.activation?.immediate === true ||
    card.templateId === "boss.iron_pirate_king"
  )
    activateBossInTransaction(tx, ruleset, cardRef, "card.use.committed");
}
function bossAt(state: AuthoritativeGameState, seat: Seat) {
  const ref = state.zones[`boss:${seat}`]?.orderedCardRefs[0];
  return ref ? state.cards[ref] : undefined;
}
export function onBossOwnerTurnStart(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  seat: Seat,
  deadlineAt = 0,
): void {
  const card = bossAt(tx.draft, seat);
  if (!card) return;
  if (
    Number(card.runtime.usedAtRound) === tx.draft.round &&
    Number(card.runtime.usedAtActiveSeat) === seat
  )
    return;
  card.runtime.ownerTurnOrdinal =
    Number(card.runtime.ownerTurnOrdinal ?? 0) + 1;
  if (card.templateId === "boss.purple_lord")
    openPurpleLordHeroBladeWindow(tx, ruleset, seat, deadlineAt);
  if (card.templateId === "boss.red_lord")
    openRedLordHammerWindow(tx, ruleset, seat, deadlineAt);
  if (card.templateId === "boss.crystal_crab") {
    openCrystalCrabActivePincerWindow(tx, ruleset, seat, deadlineAt);
    delete tx.draft.players.find((item) => item.seat === seat)!.markers[
      "crystalCrab.passivePincerLaunchedInWindow"
    ];
  }
  if (
    card.templateId === "boss.golden_mask" &&
    card.runtime.active !== true &&
    Number(card.runtime.ownerTurnOrdinal) === 1
  )
    activateBossInTransaction(
      tx,
      ruleset,
      card.cardRef,
      "owner.nthTurn.1.before",
    );
  if (card.templateId === "boss.crystal_crab" && card.runtime.active === true) {
    const player = tx.draft.players.find((item) => item.seat === seat)!;
    if (player.hp !== null && player.maxHp !== null) {
      const before = player.hp;
      player.hp = Math.min(player.maxHp, player.hp + 1);
      tx.emit("health.recovered", {
        seat,
        amount: player.hp - before,
        sourceRef: card.cardRef,
        reason: "boss.crystal_crab.turnReplacement",
      });
    }
  }
}
export function onBossEndPhaseStart(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  seat: Seat,
): void {
  const card = bossAt(tx.draft, seat);
  if (!card) return;
  const ordinal = Number(card.runtime.ownerTurnOrdinal ?? 0),
    id = card.templateId;
  if (card.runtime.active === true) {
    const expiry =
      id === "boss.purple_lord"
        ? 1
        : [
              "boss.red_lord",
              "boss.dark_grand_knight",
              "boss.giant_slime",
              "boss.golden_mask",
            ].includes(id)
          ? 2
          : null;
    if (expiry !== null && ordinal >= expiry) {
      expireBossInTransaction(tx, card.cardRef, "naturalExpiry");
      return;
    }
  }
  if (
    card.runtime.active !== true &&
    ["boss.purple_lord", "boss.red_lord", "boss.dark_grand_knight"].includes(id)
  )
    activateBossInTransaction(
      tx,
      ruleset,
      card.cardRef,
      "owner.currentPhase.end.start",
    );
}
export function onBossTurnEnd(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  seat: Seat,
): void {
  const card = bossAt(tx.draft, seat);
  if (!card) return;
  if (card.templateId === "boss.crystal_crab") {
    const ordinal = Number(card.runtime.ownerTurnOrdinal ?? 0);
    if (card.runtime.active === true && ordinal >= 2)
      expireBossInTransaction(tx, card.cardRef, "naturalExpiry");
    else if (card.runtime.active !== true)
      activateBossInTransaction(
        tx,
        ruleset,
        card.cardRef,
        "owner.currentTurn.end",
      );
  }
}
