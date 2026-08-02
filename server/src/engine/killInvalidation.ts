import type { LoadedRuleset } from "../ruleset/types.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { JsonValue, TransactionCommit } from "./types.js";

export type KillPrintedColor = "white" | "green" | "blue" | "orange" | "red";
interface RoundShieldLock extends Record<string, JsonValue> {
  sourceRef: string;
  selectedColor: KillPrintedColor;
  revealed: boolean;
  durationId: string;
}
export interface KillInvalidationResult {
  invalidated: boolean;
  sourceKind: "shield" | "roundShield" | null;
  sourceRef: string | null;
  matchedColor: KillPrintedColor | null;
}
const armorRef = (state: AuthoritativeGameState, seat: Seat) =>
  state.zones[`armor:${seat}`]?.orderedCardRefs[0] ?? null;
const equipmentEnabled = (state: AuthoritativeGameState, seat: Seat) => {
  const player = state.players.find((item) => item.seat === seat)!;
  return (
    player.markers.equipmentEffectsDisabled !== true &&
    !player.statuses.some(
      (status) => status.statusId === "status.equipmentDisabled",
    )
  );
};
const locks = (player: {
  markers: Record<string, JsonValue>;
}): RoundShieldLock[] =>
  Array.isArray(player.markers.roundShieldLocks)
    ? player.markers.roundShieldLocks.filter(
        (value): value is RoundShieldLock =>
          Boolean(value) &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          typeof (value as unknown as RoundShieldLock).sourceRef === "string",
      )
    : [];

export function evaluateKillInvalidation(
  state: AuthoritativeGameState,
  targetSeats: Seat[],
  killColors: KillPrintedColor[],
  ignoreArmor: boolean,
): KillInvalidationResult {
  if (ignoreArmor)
    return {
      invalidated: false,
      sourceKind: null,
      sourceRef: null,
      matchedColor: null,
    };
  for (const seat of targetSeats) {
    if (!equipmentEnabled(state, seat)) continue;
    const equipped = armorRef(state, seat);
    if (equipped && state.cards[equipped]!.templateId === "armor.a04") {
      const color = killColors.find(
        (item) => item === "white" || item === "blue",
      );
      if (color)
        return {
          invalidated: true,
          sourceKind: "shield",
          sourceRef: equipped,
          matchedColor: color,
        };
    }
    const player = state.players.find((item) => item.seat === seat)!;
    for (const lock of locks(player)) {
      const color = killColors.find((item) => item === lock.selectedColor);
      if (color)
        return {
          invalidated: true,
          sourceKind: "roundShield",
          sourceRef: lock.sourceRef,
          matchedColor: color,
        };
    }
  }
  return {
    invalidated: false,
    sourceKind: null,
    sourceRef: null,
    matchedColor: null,
  };
}

export function revealMatchedRoundShield(
  tx: EngineTransaction<AuthoritativeGameState>,
  sourceRef: string,
  matchedColor: KillPrintedColor,
): void {
  for (const player of tx.draft.players) {
    const current = locks(player),
      match = current.find(
        (item) =>
          item.sourceRef === sourceRef && item.selectedColor === matchedColor,
      );
    if (match && !match.revealed) {
      match.revealed = true;
      player.markers.roundShieldLocks = current as unknown as JsonValue;
      tx.emit("card.revealed", {
        cardRef: sourceRef,
        reason: "roundShieldFirstInvalidation",
        selectedColor: matchedColor,
      });
    }
  }
}

export function activateRoundShield(
  state: AuthoritativeGameState,
  seat: Seat,
  selectedColor: KillPrintedColor,
): TransactionCommit<AuthoritativeGameState> {
  if (!["white", "blue", "orange", "red"].includes(selectedColor))
    throw new Error("ROUND_SHIELD_COLOR_INVALID");
  if (
    state.lifecycle !== "inProgress" ||
    state.activeSeat !== seat ||
    state.phase !== "play" ||
    state.phaseBoundary !== "body"
  )
    throw new Error("ROUND_SHIELD_WRONG_PHASE");
  if (!equipmentEnabled(state, seat))
    throw new Error("ROUND_SHIELD_INEFFECTIVE");
  const sourceRef = armorRef(state, seat);
  if (!sourceRef || state.cards[sourceRef]!.templateId !== "armor.a08")
    throw new Error("ROUND_SHIELD_NOT_EQUIPPED");
  const player = state.players.find((item) => item.seat === seat)!;
  if (player.markers.roundShieldActivatedTurn === `${state.round}:${seat}`)
    throw new Error("ROUND_SHIELD_LIMIT_USED");
  const tx = new EngineTransaction(state),
    draft = tx.draft,
    draftPlayer = draft.players.find((item) => item.seat === seat)!,
    durationId = `duration:round-shield:${sourceRef}:${draft.stateRevision + 1}`,
    lock: RoundShieldLock = {
      sourceRef,
      selectedColor,
      revealed: false,
      durationId,
    };
  draftPlayer.markers.roundShieldActivatedTurn = `${draft.round}:${seat}`;
  draftPlayer.markers.roundShieldLocks = [
    ...locks(draftPlayer),
    lock,
  ] as unknown as JsonValue;
  draft.durations.push({
    durationId,
    sourceRef,
    ownerRef: `character:${seat}`,
    anchorEventId: null,
    activationPoint: "armor.a08.activated",
    expiryPoint: "owner.nextPhase.prepare.before",
    remainingCount: null,
    countScope: "owner",
    skipPolicy: "expireOnSkippedBoundary",
    sourceLeavePolicy: "cancel",
    ownerEliminatedPolicy: "cancel",
    cleanupEffects: [],
  });
  tx.emit("ability.activation.committed", {
    seat,
    abilityId: "armor.a08",
    sourceRef,
    selectedColorVisibility: "controllerOnly",
  });
  tx.emit("duration.created", {
    durationId,
    ownerSeat: seat,
    expiryPoint: "owner.nextPhase.prepare.before",
  });
  const committed = tx.commit();
  committed.state.history.domainEvents.push(...committed.events);
  validateAuthoritativeState(committed.state);
  return committed;
}

export function expireRoundShieldAtPrepareBefore(
  tx: EngineTransaction<AuthoritativeGameState>,
  seat: Seat,
): void {
  const draft = tx.draft,
    player = draft.players.find((item) => item.seat === seat)!,
    roundShieldIds = locks(player).map((item) => item.durationId),
    ghost = player.markers.ghostCrownActive,
    ghostId =
      ghost &&
      typeof ghost === "object" &&
      !Array.isArray(ghost) &&
      typeof ghost.durationId === "string"
        ? ghost.durationId
        : null,
    ownedIds = new Set([
      ...roundShieldIds,
      ...(ghostId ? [ghostId] : []),
    ]),
    expired = draft.durations.filter((item) => ownedIds.has(item.durationId));
  if (!expired.length) return;
  const ids = new Set(expired.map((item) => item.durationId));
  draft.durations = draft.durations.filter((item) => !ids.has(item.durationId));
  const remaining = locks(player).filter((item) => !ids.has(item.durationId));
  if (remaining.length)
    player.markers.roundShieldLocks = remaining as unknown as JsonValue;
  else delete player.markers.roundShieldLocks;
  if (
    ghost &&
    typeof ghost === "object" &&
    !Array.isArray(ghost) &&
    typeof ghost.durationId === "string" &&
    ids.has(ghost.durationId)
  )
    delete player.markers.ghostCrownActive;
  for (const duration of expired)
    tx.emit("duration.expired", {
      durationId: duration.durationId,
      point: "owner.nextPhase.prepare.before",
      skipped: false,
    });
}
