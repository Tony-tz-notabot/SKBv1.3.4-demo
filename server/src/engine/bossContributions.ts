import type { AuthoritativeGameState, Seat } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import { setEquippedTalentContributionsEnabled } from "./talentContributions.js";
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
export function cleanupBossContributionsInTransaction(
  tx: EngineTransaction<AuthoritativeGameState>,
  cardRef: string,
  reason: string,
): void {
  const card = tx.draft.cards[cardRef];
  if (!card || card.runtime.active !== true) return;
  const seat = card.controllerSeat;
  if (seat) {
    const player = tx.draft.players.find((item) => item.seat === seat)!,
      iron = Number(card.runtime.ironShieldContribution ?? 0);
    if (typeof card.runtime.specialLayerId === "string") {
      tx.emit("specialLayer.removed", {
        seat,
        sourceRef: cardRef,
        layerId: card.runtime.specialLayerId,
        remaining: Number(card.runtime.specialLayerRemaining ?? 0),
        reason,
      });
      delete card.runtime.specialLayerId;
      delete card.runtime.specialLayerRemaining;
      delete card.runtime.specialLayerRecoverable;
    }
    if (Number.isFinite(iron) && iron !== 0) {
      player.ironShield = Math.max(0, player.ironShield - iron);
      tx.emit("ironShield.modified", {
        seat,
        delta: -iron,
        sourceRef: cardRef,
      });
    }
    const equipment = sourceList(
      tx.draft,
      seat,
      "equipmentDisableSources",
    ).filter((ref) => ref !== cardRef);
    player.markers.equipmentDisableSources = equipment;
    if (!equipment.length) {
      delete player.markers.equipmentEffectsDisabled;
      setEquippedTalentContributionsEnabled(tx, seat, true);
    }
    const immunity = sourceList(
      tx.draft,
      seat,
      "bossControlImmunitySources",
    ).filter((ref) => ref !== cardRef);
    player.markers.bossControlImmunitySources = immunity;
    if (!immunity.length) delete player.markers.bossControlImmunitySources;
    for (const status of [...player.statuses].filter(
      (item) => item.sourceRef === cardRef,
    )) {
      player.statuses = player.statuses.filter(
        (item) => item.statusRef !== status.statusRef,
      );
      if (status.durationId)
        tx.draft.durations = tx.draft.durations.filter(
          (item) => item.durationId !== status.durationId,
        );
      tx.emit("status.removed", {
        ownerSeat: seat,
        statusId: status.statusId,
        statusRef: status.statusRef,
        sourceRef: cardRef,
      });
    }
  }
  for (const scheduled of tx.draft.scheduledEffects.filter(
    (item) => item.sourceRef === cardRef && !item.cancelled,
  )) {
    scheduled.cancelled = true;
    tx.emit("effect.cancelled", {
      scheduledId: scheduled.scheduledId,
      sourceRef: cardRef,
      reason: "bossSourceLeftBeforeCreation",
    });
  }
  card.runtime.active = false;
  card.runtime.activationStatus = "expired";
  tx.emit("boss.expired", { seat, cardRef, bossId: card.templateId, reason });
}
