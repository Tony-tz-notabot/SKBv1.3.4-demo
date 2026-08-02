import type { AuthoritativeGameState, Seat } from "./state.js";
import { EngineTransaction } from "./transaction.js";

export function copyTemporaryCardToHandInTransaction(
  tx: EngineTransaction<AuthoritativeGameState>,
  input: {
    templateId: string;
    ownerSeat: Seat;
    sourceRef: string;
    generatedBy: string;
    exitZoneRef?: "outsideDeck" | "removedFromGame";
  },
): string {
  const serial =
      Object.keys(tx.draft.cards).filter((ref) => ref.startsWith("generated:"))
        .length + 1,
    cardRef = `generated:${tx.draft.stateRevision + 1}:${serial}:${input.templateId}`,
    zoneRef = `hand:${input.ownerSeat}`;
  if (tx.draft.cards[cardRef]) throw new Error("GENERATED_CARD_REF_COLLISION");
  tx.draft.cards[cardRef] = {
    cardRef,
    templateId: input.templateId,
    zoneRef,
    ownerSeat: input.ownerSeat,
    controllerSeat: input.ownerSeat,
    faceUp: false,
    runtime: {
      generated: true,
      generatedBy: input.generatedBy,
      generatedFromRef: input.sourceRef,
      generatedExitZoneRef: input.exitZoneRef ?? "outsideDeck",
    },
  };
  tx.draft.zones[zoneRef]!.orderedCardRefs.push(cardRef);
  tx.emit("card.created", {
    cardRef,
    templateId: input.templateId,
    ownerSeat: input.ownerSeat,
    zoneRef,
    generatedBy: input.generatedBy,
    sourceRef: input.sourceRef,
    exitZoneRef: input.exitZoneRef ?? "outsideDeck",
  });
  tx.emit("card.gained", {
    cardRef,
    templateId: input.templateId,
    seat: input.ownerSeat,
    reason: input.generatedBy,
  });
  return cardRef;
}
