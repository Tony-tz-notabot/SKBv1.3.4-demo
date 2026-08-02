import { handCards, type AuthoritativeGameState, type Seat } from "./state.js";

export function calculateHandLimit(
  state: AuthoritativeGameState,
  seat: Seat,
): number {
  const player = state.players.find((item) => item.seat === seat);
  if (!player) throw new Error("PLAYER_NOT_FOUND");
  const modifier = player.limits.handLimitModifier ?? 0;
  if (
    typeof modifier !== "number" ||
    !Number.isFinite(modifier) ||
    !Number.isInteger(modifier)
  )
    throw new Error("HAND_LIMIT_MODIFIER_INVALID");
  return Math.max(
    0,
    Math.min(4, player.hp ?? 0) +
      modifier +
      Number(player.markers["talent.handLimitContribution"] ?? 0),
  );
}

export const requiredDiscardCount = (
  state: AuthoritativeGameState,
  seat: Seat,
): number =>
  Math.max(0, handCards(state, seat).length - calculateHandLimit(state, seat));
