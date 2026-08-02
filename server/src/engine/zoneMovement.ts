import { handleDarkKnightBossLeave } from "./darkKnightFinalStrike.js";
import { eliminatePlayer } from "./deathReplacement.js";
import type { AuthoritativeGameState } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import { cleanupBossContributionsInTransaction } from "./bossContributions.js";
import { applyTalentEquipContribution } from "./talentContributions.js";

export type MoveKind =
  | "draw"
  | "play"
  | "use"
  | "respond"
  | "discard"
  | "lose"
  | "gain"
  | "give"
  | "equip"
  | "replace"
  | "dismantle"
  | "synthesizeConsume"
  | "transform"
  | "reveal"
  | "judge"
  | "return"
  | "remove"
  | "systemMove";

export interface MoveCardInput {
  cardRef: string;
  toZoneRef: string;
  moveKind: MoveKind;
  position?: "top" | "bottom";
  faceUp?: boolean;
}

const activeEquipmentZoneTypes = new Set([
  "weaponSlot",
  "thirdWeaponSlot",
  "armorSlot",
  "mountOffenseSlot",
  "mountDefenseSlot",
  "talentZone",
  "bossSlot",
]);

export function moveCardInTransaction(
  transaction: EngineTransaction<AuthoritativeGameState>,
  input: MoveCardInput,
): void {
  const draft = transaction.draft,
    card = draft.cards[input.cardRef];
  if (!card) throw new Error("CARD_NOT_FOUND");
  const generatedExit =
      typeof card.runtime.generatedExitZoneRef === "string"
        ? card.runtime.generatedExitZoneRef
        : null,
    terminalRedirect =
      generatedExit && ["discardPile", "drawPile"].includes(input.toZoneRef)
        ? generatedExit
        : input.toZoneRef,
    destination = draft.zones[terminalRedirect];
  if (!destination) throw new Error("DESTINATION_ZONE_NOT_FOUND");
  const source = draft.zones[card.zoneRef];
  if (!source) throw new Error("SOURCE_ZONE_NOT_FOUND");
  if (source.zoneRef === destination.zoneRef)
    throw new Error("CARD_ALREADY_IN_DESTINATION");
  const ironPirateOwner =
    source.zoneType === "bossSlot" &&
    card.templateId === "boss.iron_pirate_king" &&
    source.ownerSeat
      ? draft.players.find((player) => player.seat === source.ownerSeat)
      : null;
  if (
    ironPirateOwner?.lifeState === "deadNotEliminated" &&
    (input.moveKind === "discard" || input.moveKind === "replace")
  )
    throw new Error("IRON_PIRATE_ACTIVE_REMOVAL_ILLEGAL_AFTER_DEATH");
  const index = source.orderedCardRefs.indexOf(input.cardRef);
  if (index < 0) throw new Error("CARD_SOURCE_MEMBERSHIP_INVALID");
  if (source.zoneType === "bossSlot")
    cleanupBossContributionsInTransaction(
      transaction,
      input.cardRef,
      `bossLeave:${input.moveKind}`,
    );
  source.orderedCardRefs.splice(index, 1);
  if ((input.position ?? "bottom") === "top")
    destination.orderedCardRefs.unshift(input.cardRef);
  else destination.orderedCardRefs.push(input.cardRef);
  card.zoneRef = destination.zoneRef;
  card.ownerSeat = destination.ownerSeat;
  card.controllerSeat = destination.ownerSeat;
  card.faceUp =
    input.faceUp ?? !["drawPile", "hand"].includes(destination.zoneType);
  if (
    activeEquipmentZoneTypes.has(source.zoneType) &&
    !activeEquipmentZoneTypes.has(destination.zoneType) &&
    card.runtime.restoreBaseTemplateOnLeaveEquipment === true &&
    typeof card.runtime.transformedBaseTemplateId === "string"
  ) {
    const fromTemplateId = card.templateId;
    card.templateId = card.runtime.transformedBaseTemplateId;
    delete card.runtime.transformedBaseTemplateId;
    delete card.runtime.restoreBaseTemplateOnLeaveEquipment;
    transaction.emit("card.transformed", {
      cardRef: input.cardRef,
      fromTemplateId,
      toTemplateId: card.templateId,
      reason: "leaveEquipmentRestoreBaseTemplate",
    });
  }
  transaction.emit("card.moved", {
    cardRef: input.cardRef,
    fromZoneRef: source.zoneRef,
    toZoneRef: destination.zoneRef,
    moveKind: input.moveKind,
    ...(terminalRedirect !== input.toZoneRef
      ? { requestedToZoneRef: input.toZoneRef, generatedExitRedirect: true }
      : {}),
  });
  if (activeEquipmentZoneTypes.has(source.zoneType))
    transaction.emit("card.lost", {
      cardRef: input.cardRef,
      lostFamilyId: card.templateId,
      ownerSeat: source.ownerSeat,
      seat: source.ownerSeat,
      fromZoneRef: source.zoneRef,
      fromZoneType: source.zoneType,
      toZoneRef: destination.zoneRef,
      moveKind: input.moveKind,
    });
  if (
    source.zoneType === "talentZone" &&
    source.ownerSeat &&
    card.templateId.startsWith("talent.") &&
    card.runtime.talentContributionActive === true
  )
    applyTalentEquipContribution(
      transaction,
      source.ownerSeat,
      card.templateId,
      -1,
      card.runtime.talentContribution,
    );
  if (source.zoneType === "talentZone")
    delete card.runtime.talentContributionActive;
  if (
    source.zoneType === "bossSlot" &&
    card.templateId === "boss.dark_grand_knight" &&
    source.ownerSeat
  )
    handleDarkKnightBossLeave(transaction, source.ownerSeat);
  if (ironPirateOwner?.lifeState === "deadNotEliminated")
    eliminatePlayer(
      transaction,
      ironPirateOwner.seat,
      "ironPirateLostAfterDeath",
    );
}
