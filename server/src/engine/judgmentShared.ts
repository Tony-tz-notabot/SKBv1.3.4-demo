import type { LoadedRuleset } from "../ruleset/types.js";
import type { AuthoritativeGameState, Seat } from "./state.js";

export type CardColor = "white" | "green" | "blue" | "orange" | "red";
interface CardFact {
  cardId: string;
  color: CardColor;
}

export function findShaman(draft: AuthoritativeGameState): Seat | null {
  const player = draft.players.find(
    (item) =>
      item.characterId === "character.shaman" &&
      item.lifeState !== "eliminated",
  );
  return player?.seat ?? null;
}
export function sameColorRefs(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  seat: Seat,
): string[] {
  const colors = facts(ruleset),
    hand = state.zones[`hand:${seat}`]!.orderedCardRefs,
    counts = new Map<CardColor, number>();
  for (const ref of hand) {
    const color = colors.get(state.cards[ref]!.templateId)?.color;
    if (color) counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  return hand.filter((ref) => {
    const color = colors.get(state.cards[ref]!.templateId)?.color;
    return color && (counts.get(color) ?? 0) >= 2;
  });
}
export function facts(ruleset: LoadedRuleset): Map<string, CardFact> {
  const document = ruleset.documents.get("cards.json") as {
    items: CardFact[];
  };
  return new Map(document.items.map((item) => [item.cardId, item]));
}
