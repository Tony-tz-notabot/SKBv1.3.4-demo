import { EngineTransaction } from "./transaction.js";
import type { AuthoritativeGameState } from "./state.js";
import type { TransactionCommit } from "./types.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import {
  processCommittedEventTriggers,
  type TriggeredCommitResult,
} from "./triggerBridge.js";
import { moveCardInTransaction, type MoveCardInput } from "./zoneMovement.js";
export { moveCardInTransaction } from "./zoneMovement.js";
export type { MoveCardInput, MoveKind } from "./zoneMovement.js";

export function moveCard(
  state: AuthoritativeGameState,
  input: MoveCardInput,
): TransactionCommit<AuthoritativeGameState> {
  const transaction = new EngineTransaction(state);
  moveCardInTransaction(transaction, input);
  const committed = transaction.commit();
  committed.state.history.domainEvents.push(...committed.events);
  validateAuthoritativeState(committed.state);
  return committed;
}

export type TriggeredMoveResult = TriggeredCommitResult;

export function moveCardAndProcessTriggers(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  input: MoveCardInput,
  deadlineAt: number,
): TriggeredMoveResult {
  return processCommittedEventTriggers(
    moveCard(state, input),
    ruleset,
    deadlineAt,
  );
}
