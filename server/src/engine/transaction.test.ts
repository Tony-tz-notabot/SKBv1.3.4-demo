import { describe, expect, it } from "vitest";
import { EngineTransaction } from "./transaction.js";

interface TestState { gameId: string; stateRevision: number; lastEventSeq: number; hp: number; nested: { value: number } }
const state = (): TestState => ({ gameId: "g1", stateRevision: 7, lastEventSeq: 12, hp: 6, nested: { value: 1 } });

describe("EngineTransaction", () => {
  it("commits state and events under one new revision", () => {
    const original = state();
    const transaction = new EngineTransaction(original);
    transaction.draft.hp = 4;
    transaction.emit("damage.applied", { amount: 2 });
    transaction.emit("damage.after", { target: "seat:1" });
    const committed = transaction.commit();
    expect(committed.previousRevision).toBe(7);
    expect(committed.state).toMatchObject({ hp: 4, stateRevision: 8, lastEventSeq: 14 });
    expect(committed.events.map((event) => [event.eventSeq, event.stateRevision])).toEqual([[13, 8], [14, 8]]);
    expect(original).toEqual(state());
  });

  it("returns the untouched original on rollback", () => {
    const original = state();
    const transaction = new EngineTransaction(original);
    transaction.draft.nested.value = 99;
    expect(transaction.rollback()).toBe(original);
    expect(original.nested.value).toBe(1);
  });

  it("cannot be reused after commit", () => {
    const transaction = new EngineTransaction(state());
    transaction.commit();
    expect(() => transaction.emit("action.resolve", {})).toThrow("ENGINE_TRANSACTION_CLOSED");
  });
});
