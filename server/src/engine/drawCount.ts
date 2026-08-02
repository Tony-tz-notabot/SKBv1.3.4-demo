import type { AuthoritativeGameState, Seat } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import type { JsonValue } from "./types.js";

export interface DrawCountModifierState {
  modifierId: string;
  sourceRef: string | null;
  delta: number;
  remainingAffectedDraws: number | null;
}
const MARKER = "draw.countModifiers";

function decode(value: JsonValue | undefined): DrawCountModifierState[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const modifierId = item.modifierId,
      sourceRef = item.sourceRef,
      delta = item.delta,
      remaining = item.remainingAffectedDraws;
    if (
      typeof modifierId !== "string" ||
      (sourceRef !== null && typeof sourceRef !== "string") ||
      typeof delta !== "number" ||
      !Number.isInteger(delta) ||
      (remaining !== null &&
        (typeof remaining !== "number" ||
          !Number.isInteger(remaining) ||
          remaining < 1))
    )
      return [];
    return [
      {
        modifierId,
        sourceRef,
        delta,
        remainingAffectedDraws: remaining,
      },
    ];
  });
}

function player(state: AuthoritativeGameState, seat: Seat) {
  const value = state.players.find((item) => item.seat === seat);
  if (!value) throw new Error("PLAYER_NOT_FOUND");
  return value;
}

export function drawCountModifiers(
  state: AuthoritativeGameState,
  seat: Seat,
): DrawCountModifierState[] {
  return decode(player(state, seat).markers[MARKER]);
}

export function calculateDrawCount(
  state: AuthoritativeGameState,
  seat: Seat,
  baseCount: number,
) {
  if (!Number.isInteger(baseCount)) throw new Error("DRAW_BASE_INVALID");
  const modifiers = drawCountModifiers(state, seat),
    rawCount = modifiers.reduce(
      (sum, modifier) => sum + modifier.delta,
      baseCount,
    );
  return {
    baseCount,
    modifiers,
    rawCount,
    actualCount: Math.max(0, rawCount),
  };
}

export function addDrawCountModifierInTransaction(
  tx: EngineTransaction<AuthoritativeGameState>,
  input: {
    seat: Seat;
    modifierId: string;
    sourceRef?: string | null;
    delta: number;
    remainingAffectedDraws?: number | null;
  },
): void {
  if (!input.modifierId || !Number.isInteger(input.delta))
    throw new Error("DRAW_MODIFIER_INVALID");
  const remaining =
    input.remainingAffectedDraws === undefined
      ? 1
      : input.remainingAffectedDraws;
  if (remaining !== null && (!Number.isInteger(remaining) || remaining < 1))
    throw new Error("DRAW_MODIFIER_DURATION_INVALID");
  const owner = player(tx.draft, input.seat),
    modifiers = decode(owner.markers[MARKER]);
  if (modifiers.some((item) => item.modifierId === input.modifierId))
    throw new Error("DRAW_MODIFIER_ID_DUPLICATE");
  modifiers.push({
    modifierId: input.modifierId,
    sourceRef: input.sourceRef ?? null,
    delta: input.delta,
    remainingAffectedDraws: remaining,
  });
  owner.markers[MARKER] = modifiers as unknown as JsonValue;
  tx.emit("draw.modifier.added", {
    seat: input.seat,
    modifierId: input.modifierId,
    sourceRef: input.sourceRef ?? null,
    delta: input.delta,
    remainingAffectedDraws: remaining,
  });
}

export function consumeDrawCountModifiersAtDrawBoundary(
  tx: EngineTransaction<AuthoritativeGameState>,
  seat: Seat,
  boundary: "resolved" | "skipped" = "resolved",
): void {
  const owner = player(tx.draft, seat),
    modifiers = decode(owner.markers[MARKER]),
    retained: DrawCountModifierState[] = [];
  for (const modifier of modifiers) {
    if (modifier.remainingAffectedDraws === null) {
      retained.push(modifier);
      continue;
    }
    const remaining = modifier.remainingAffectedDraws - 1;
    tx.emit("draw.modifier.consumed", {
      seat,
      modifierId: modifier.modifierId,
      remainingAffectedDraws: remaining,
      boundary,
    });
    if (remaining > 0)
      retained.push({ ...modifier, remainingAffectedDraws: remaining });
  }
  if (retained.length) owner.markers[MARKER] = retained as unknown as JsonValue;
  else delete owner.markers[MARKER];
}

/** @deprecated Prefer the boundary-named function for new call sites. */
export function consumeDrawCountModifiersAfterDraw(
  tx: EngineTransaction<AuthoritativeGameState>,
  seat: Seat,
): void {
  consumeDrawCountModifiersAtDrawBoundary(tx, seat, "resolved");
}
