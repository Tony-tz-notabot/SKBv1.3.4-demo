import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { JsonValue, TransactionCommit } from "./types.js";

export interface GuaranteedCriticalGrant extends Record<string, JsonValue> {
  grantId: string;
  sourceRef: string | null;
  ownerSeat: Seat;
  appliesTo: "weaponAttack" | "killAttack";
  consumePolicy: "onFirstCommittedApplicableAttack" | "retainUntilExpiry";
  expiryPoint: "owner.currentTurn.end" | "owner.nextTurn.end";
}
const grants = (
  state: AuthoritativeGameState,
  seat: Seat,
): GuaranteedCriticalGrant[] => {
  const raw = state.players.find((item) => item.seat === seat)!.markers
    .guaranteedCriticalGrants;
  return Array.isArray(raw)
    ? raw.filter(
        (value): value is GuaranteedCriticalGrant =>
          Boolean(value) &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          typeof (value as GuaranteedCriticalGrant).grantId === "string",
      )
    : [];
};

export function grantGuaranteedCriticalInTransaction(
  tx: EngineTransaction<AuthoritativeGameState>,
  input: {
    ownerSeat: Seat;
    sourceRef?: string | null;
    appliesTo: "weaponAttack" | "killAttack";
    consumePolicy: "onFirstCommittedApplicableAttack" | "retainUntilExpiry";
    expiryPoint: "owner.currentTurn.end" | "owner.nextTurn.end";
  },
): GuaranteedCriticalGrant {
  const draft = tx.draft,
    player = draft.players.find((item) => item.seat === input.ownerSeat);
  if (!player || player.lifeState === "eliminated")
    throw new Error("GUARANTEED_CRITICAL_OWNER_INVALID");
  const grant: GuaranteedCriticalGrant = {
    grantId: `critical-grant:${draft.stateRevision + 1}:${input.ownerSeat}:${grants(draft, input.ownerSeat).length}`,
    sourceRef: input.sourceRef ?? null,
    ownerSeat: input.ownerSeat,
    appliesTo: input.appliesTo,
    consumePolicy: input.consumePolicy,
    expiryPoint: input.expiryPoint,
  };
  player.markers.guaranteedCriticalGrants = [
    ...grants(draft, input.ownerSeat),
    grant,
  ] as unknown as JsonValue;
  tx.emit("critical.granted", grant);
  return grant;
}
export function grantGuaranteedCritical(
  state: AuthoritativeGameState,
  input: {
    ownerSeat: Seat;
    sourceRef?: string | null;
    appliesTo: "weaponAttack" | "killAttack";
    consumePolicy: "onFirstCommittedApplicableAttack" | "retainUntilExpiry";
    expiryPoint: "owner.currentTurn.end" | "owner.nextTurn.end";
  },
): TransactionCommit<AuthoritativeGameState> {
  const tx = new EngineTransaction(state);
  grantGuaranteedCriticalInTransaction(tx, input);
  const committed = tx.commit();
  committed.state.history.domainEvents.push(...committed.events);
  validateAuthoritativeState(committed.state);
  return committed;
}

export function consumeGuaranteedCriticalForCommittedAttack(
  tx: EngineTransaction<AuthoritativeGameState>,
  seat: Seat,
  attackKind: "weapon" | "handKnife",
): GuaranteedCriticalGrant | null {
  const draft = tx.draft,
    player = draft.players.find((item) => item.seat === seat)!,
    current = grants(draft, seat),
    grant = current.find(
      (item) =>
        item.appliesTo === "killAttack" ||
        (item.appliesTo === "weaponAttack" && attackKind === "weapon"),
    );
  if (!grant) return null;
  if (grant.consumePolicy === "onFirstCommittedApplicableAttack") {
    const remaining = current.filter((item) => item.grantId !== grant.grantId);
    if (remaining.length)
      player.markers.guaranteedCriticalGrants =
        remaining as unknown as JsonValue;
    else delete player.markers.guaranteedCriticalGrants;
  }
  tx.emit("critical.consumed", {
    grantId: grant.grantId,
    sourceRef: grant.sourceRef,
    seat,
    attackKind,
    retained: grant.consumePolicy === "retainUntilExpiry",
  });
  return grant;
}

export function expireGuaranteedCriticalAtTurnEnd(
  tx: EngineTransaction<AuthoritativeGameState>,
  seat: Seat,
): void {
  const player = tx.draft.players.find((item) => item.seat === seat)!,
    current = grants(tx.draft, seat),
    expired = current.filter(
      (item) => item.expiryPoint === "owner.currentTurn.end",
    ),
    remaining = current
      .filter((item) => item.expiryPoint !== "owner.currentTurn.end")
      .map((item) => ({
        ...item,
        expiryPoint: "owner.currentTurn.end" as const,
      }));
  if (remaining.length)
    player.markers.guaranteedCriticalGrants = remaining as unknown as JsonValue;
  else delete player.markers.guaranteedCriticalGrants;
  for (const grant of expired)
    tx.emit("critical.expired", {
      grantId: grant.grantId,
      sourceRef: grant.sourceRef,
      seat,
      expiryPoint: grant.expiryPoint,
    });
  for (const grant of remaining)
    tx.emit("critical.armed", {
      grantId: grant.grantId,
      sourceRef: grant.sourceRef,
      seat,
      expiryPoint: grant.expiryPoint,
    });
}
