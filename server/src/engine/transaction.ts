import type { DomainEvent, JsonValue, PendingDomainEvent, RevisionedState, TransactionCommit } from "./types.js";

export class EngineTransaction<TState extends RevisionedState> {
  readonly #original: TState;
  readonly #draft: TState;
  readonly #events: PendingDomainEvent[] = [];
  #closed = false;

  constructor(state: TState) {
    this.#original = state;
    this.#draft = structuredClone(state);
  }

  get draft(): TState {
    this.#assertOpen();
    return this.#draft;
  }

  emit(eventType: string, payload: JsonValue): void {
    this.#assertOpen();
    this.#events.push({ eventType, payload: structuredClone(payload) });
  }

  commit(): TransactionCommit<TState> {
    this.#assertOpen();
    this.#closed = true;
    const previousRevision = this.#original.stateRevision;
    const stateRevision = previousRevision + 1;
    const firstEventSeq = this.#original.lastEventSeq + 1;
    const events: DomainEvent[] = this.#events.map((event, index) => ({
      ...event,
      eventSeq: firstEventSeq + index,
      stateRevision,
    }));
    this.#draft.stateRevision = stateRevision;
    this.#draft.lastEventSeq = events.at(-1)?.eventSeq ?? this.#original.lastEventSeq;
    return { previousRevision, state: this.#draft, events };
  }

  rollback(): TState {
    this.#assertOpen();
    this.#closed = true;
    return this.#original;
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("ENGINE_TRANSACTION_CLOSED");
  }
}
