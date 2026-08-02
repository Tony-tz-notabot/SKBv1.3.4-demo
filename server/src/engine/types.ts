export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface RevisionedState {
  gameId: string;
  stateRevision: number;
  lastEventSeq: number;
}

export interface PendingDomainEvent {
  eventType: string;
  payload: JsonValue;
}

export interface DomainEvent extends PendingDomainEvent {
  eventSeq: number;
  stateRevision: number;
}

export interface TransactionCommit<TState extends RevisionedState> {
  previousRevision: number;
  state: TState;
  events: DomainEvent[];
}
