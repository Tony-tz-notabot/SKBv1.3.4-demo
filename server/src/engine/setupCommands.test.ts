import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { createInitialSetup } from "./setup.js";
import { projectRedrawOffer, projectSetupPresentationEvents, projectSetupView, SetupCommandSession, type RedrawCommand } from "./setupCommands.js";
import { handCards } from "./state.js";

let ruleset: LoadedRuleset;
const users = { 1: "u1", 2: "u2", 3: "u3", 4: "u4" } as const;
const characters={1:"character.knight",2:"character.alchemist",3:"character.ranger",4:"character.wizard"} as const;
beforeAll(async () => { ruleset = await loadFrozenRuleset(resolve(import.meta.dirname, "../../../rulesets/v1.3.4")); });
const session = () => new SetupCommandSession(createInitialSetup(ruleset, { gameId: "g", firstSeat: 1, seed: 7, usersBySeat: users,characterIdsBySeat:characters, setupStartedAt: 1000 }), ruleset, () => 2000);
const command = (overrides: Partial<RedrawCommand> = {}): RedrawCommand => ({ commandId: "cmd1", gameId: "g", expectedStateRevision: 0, actorUserId: "u1", promptId: "prompt:setup-redraw:1", offerId: "offer:setup-redraw:1", redraw: false, ...overrides });

describe("setup command boundary", () => {
  it("projects only the viewer's unresolved private offer", () => {
    const current = session();
    expect(projectRedrawOffer(current.state, "u1")?.offerId).toBe("offer:setup-redraw:1");
    expect(projectRedrawOffer(current.state, "spectator")).toBeNull();
    current.handle(command());
    expect(projectRedrawOffer(current.state, "u1")).toBeNull();
    expect(projectRedrawOffer(current.state, "u2")?.offerId).toBe("offer:setup-redraw:2");
  });

  it("returns the first result for duplicate commandId without executing twice", () => {
    const current = session();
    const first = current.handle(command({ redraw: true }));
    const revision = current.state.stateRevision;
    const duplicate = current.handle(command({ expectedStateRevision: 999, redraw: false }));
    expect(duplicate).toEqual(first);
    expect(current.state.stateRevision).toBe(revision);
  });

  it("rejects stale, foreign and expired commands without state changes", () => {
    const current = session();
    expect(current.handle(command({ commandId: "stale", expectedStateRevision: 9 }))).toMatchObject({ accepted: false, reasonCode: "STALE_REVISION" });
    expect(current.handle(command({ commandId: "foreign", actorUserId: "outsider" }))).toMatchObject({ accepted: false, reasonCode: "NOT_YOUR_PRIORITY" });
    expect(current.handle(command({ commandId: "expired", offerId: "wrong" }))).toMatchObject({ accepted: false, reasonCode: "OFFER_EXPIRED" });
    expect(current.state.stateRevision).toBe(0);
  });

  it("uses pass on timeout", () => {
    const current = session();
    expect(current.handleTimeout(2, "timeout:2")).toMatchObject({ accepted: true, stateRevision: 1 });
    expect(current.state.setup?.redrawBySeat[2]).toEqual({ decided: true, used: false });
  });

  it("never projects another player's hidden card identities", () => {
    const current = session();
    const u1 = projectSetupView(current.state, "u1", ruleset);
    const u2 = projectSetupView(current.state, "u2", ruleset);
    const spectator = projectSetupView(current.state, null, ruleset);
    expect(u1.protocolMessage.hand).toHaveLength(4);
    expect(u2.protocolMessage.hand).toHaveLength(4);
    expect(spectator.protocolMessage.hand).toEqual([]);
    const u1InternalRefs = handCards(current.state,1);
    const serializedU2 = JSON.stringify(u2);
    expect(u1InternalRefs.every((ref) => !serializedU2.includes(ref))).toBe(true);
    expect(spectator.protocolMessage.interaction.offers).toEqual([]);
    expect(u1.protocolMessage.interaction.prompt?.deadlineAt).toBe(11000);
    expect(u1.protocolMessage.serverTime).toBeTypeOf("number");
  });

  it("returns fresh audience projections with an accepted command", () => {
    const current = session();
    const result = current.handle(command());
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.projections).toHaveLength(5);
    expect(result.projections.every((projection) => projection.protocolMessage.stateRevision === 1)).toBe(true);
  });

  it("maps setup domain events without exposing replacement card identities", () => {
    const current = session();
    const result = current.handle(command({ redraw: true }));
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    const events = projectSetupPresentationEvents(result.events, "u2", current.state);
    expect(events).toEqual([expect.objectContaining({ eventType: "SETUP_REDRAW_RESOLVED", payload: { seat: 1, redraw: true } })]);
    expect(JSON.stringify(events)).not.toContain("card:");
  });
});
