import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { executeNextImmediateDamageEffect } from "./directDamage.js";
import {
  buildInternetAddictionOffers,
  InternetAddictionSession,
} from "./internetAddiction.js";
import { JudgmentInterventionSession } from "./judgmentIntervention.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";

let ruleset: LoadedRuleset;
beforeAll(async () => {
  ruleset = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});

function relocate(
  state: AuthoritativeGameState,
  ref: string,
  zoneRef: string,
  top = false,
) {
  const card = state.cards[ref]!,
    source = state.zones[card.zoneRef]!,
    target = state.zones[zoneRef]!;
  source.orderedCardRefs.splice(source.orderedCardRefs.indexOf(ref), 1);
  if (top) target.orderedCardRefs.unshift(ref);
  else target.orderedCardRefs.push(ref);
  Object.assign(card, {
    zoneRef,
    ownerSeat: target.ownerSeat,
    controllerSeat: target.ownerSeat,
    faceUp: !["hand", "drawPile"].includes(target.zoneType),
  });
}

function ready(familyId: "special.sp01" | "special.sp02") {
  let state = createInitialSetup(ruleset, {
    gameId: familyId,
    firstSeat: 1,
    seed: 1202,
    usersBySeat: { 1: "u1", 2: "u2", 3: "u3", 4: "u4" },
    characterIdsBySeat: {
      1: "character.knight",
      2: "character.alchemist",
      3: "character.ranger",
      4: "character.wizard",
    },
  });
  for (const seat of [1, 2, 3, 4] as const)
    state = resolveInitialRedraw(state, seat, false, ruleset).state;
  const card = Object.values(state.cards).find(
    (candidate) => candidate.templateId === familyId,
  )!;
  relocate(state, card.cardRef, "hand:1");
  for (const player of state.players) {
    player.hp = 10;
    player.maxHp = 10;
    player.shield = 10;
    player.maxShield = 10;
    player.initialTalentIds = [];
  }
  Object.assign(state, {
    activeSeat: 1,
    phase: "play",
    phaseBoundary: "body",
    phaseMode: "manual",
    phaseBodyResolved: false,
  });
  state.pendingWindows = [
    {
      promptId: "play:internet",
      kind: "playPhaseAction",
      prioritySeat: 1,
      mandatory: false,
      deadlineAt: 900,
      timeoutPolicy: "pass",
      legalOfferIds: ["offer:playPhaseAction:finish"],
      context: {},
    },
  ];
  return { state, cardRef: card.cardRef, familyId };
}

function use(prepared: ReturnType<typeof ready>) {
  const session = new InternetAddictionSession(
      prepared.state,
      ruleset,
      () => 1000,
    ),
    cmd = {
      commandId: "use",
      gameId: prepared.state.gameId,
      expectedStateRevision: prepared.state.stateRevision,
      actorUserId: "u1",
      promptId: "play:internet",
      offerId: `offer:${prepared.familyId}:${prepared.cardRef}`,
      cardRef: prepared.cardRef,
    };
  const result = session.handle(cmd);
  expect(result.accepted).toBe(true);
  expect(session.handle(cmd)).toEqual(result);
  return session;
}

function pass(session: InternetAddictionSession, id: string) {
  const window = session.state.pendingWindows[0]!,
    actor = session.state.players.find(
      (player) => player.seat === window.prioritySeat,
    )!;
  return session.handle({
    commandId: id,
    gameId: session.state.gameId,
    expectedStateRevision: session.state.stateRevision,
    actorUserId: actor.userId,
    promptId: window.promptId,
    offerId: window.legalOfferIds.find((offer) => offer.endsWith(":pass"))!,
    cardRef: String(window.context!.cardRef),
  });
}

describe("Internet-addiction twins", () => {
  it.each(["special.sp01", "special.sp02"] as const)(
    "runs the same collect-all then x-electric flow for %s",
    (familyId) => {
      const prepared = ready(familyId),
        session = use(prepared);
      expect(
        buildInternetAddictionOffers(prepared.state, ruleset, 1)[0],
      ).toMatchObject({ familyId });
      expect(session.state.pendingWindows[0]).toMatchObject({
        prioritySeat: 2,
      });
      pass(session, "pass2");
      pass(session, "pass3");
      pass(session, "pass4");
      let state = session.state;
      expect(state.players.map((player) => player.shield)).toEqual([
        10, 10, 10, 10,
      ]);
      expect(state.scheduledEffects).toHaveLength(7);
      while (state.scheduledEffects.length)
        state = executeNextImmediateDamageEffect(state, ruleset).state;
      expect(state.players.map((player) => player.shield)).toEqual([
        10, 7, 7, 7,
      ]);
      expect(
        state.players
          .slice(1)
          .map((p) => Number(p.markers.electricMark ?? 0)),
      ).toEqual([1, 1, 1]);
      expect(state.cards[prepared.cardRef]!.zoneRef).toBe("discardPile");
      expect(state.pendingWindows[0]).toMatchObject({
        kind: "playPhaseAction",
        prioritySeat: 1,
      });
    },
  );

  it("counts a physical Dodge and scales damage only by nonresponders", () => {
    const prepared = ready("special.sp01"),
      dodge = Object.values(prepared.state.cards).find((card) =>
        card.templateId.startsWith("basic.dodge."),
      )!;
    relocate(prepared.state, dodge.cardRef, "hand:2");
    const session = use(prepared),
      window = session.state.pendingWindows[0]!,
      offerId = window.legalOfferIds.find((offer) => offer.includes(":play:"))!;
    session.handle({
      commandId: "dodge2",
      gameId: session.state.gameId,
      expectedStateRevision: session.state.stateRevision,
      actorUserId: "u2",
      promptId: window.promptId,
      offerId,
      cardRef: prepared.cardRef,
    });
    pass(session, "pass3");
    pass(session, "pass4");
    let state = session.state;
    while (state.scheduledEffects.length)
      state = executeNextImmediateDamageEffect(state, ruleset).state;
    expect(state.players.map((player) => player.shield)).toEqual([
      10, 10, 8, 8,
    ]);
  });

  it("allows judgment armor; success responds, while the attempt cannot repeat", () => {
    const prepared = ready("special.sp02"),
      armor = Object.values(prepared.state.cards).find(
        (card) => card.templateId === "armor.a01",
      )!,
      orange = Object.values(prepared.state.cards).find(
        (card) =>
          (
            ruleset.documents.get("cards.json") as {
              items: Array<{ cardId: string; color: string }>;
            }
          ).items.find((item) => item.cardId === card.templateId)?.color ===
          "orange",
      )!;
    relocate(prepared.state, armor.cardRef, "armor:2");
    relocate(prepared.state, orange.cardRef, "drawPile", true);
    const useSession = use(prepared),
      window = useSession.state.pendingWindows[0]!,
      armorOffer = window.legalOfferIds.find((offer) =>
        offer.includes(":armorJudgment:"),
      )!;
    useSession.handle({
      commandId: "armor2",
      gameId: useSession.state.gameId,
      expectedStateRevision: useSession.state.stateRevision,
      actorUserId: "u2",
      promptId: window.promptId,
      offerId: armorOffer,
      cardRef: prepared.cardRef,
    });
    const judgment = new JudgmentInterventionSession(useSession.state, ruleset);
    for (let index = 0; index < 4; index += 1) {
      const current = judgment.state.pendingWindows[0]!,
        actor = judgment.state.players.find(
          (player) => player.seat === current.prioritySeat,
        )!;
      judgment.handle({
        commandId: `judge-pass:${index}`,
        gameId: judgment.state.gameId,
        expectedStateRevision: judgment.state.stateRevision,
        actorUserId: actor.userId,
        promptId: current.promptId,
        offerId: current.legalOfferIds[0]!,
      });
    }
    expect(judgment.state.pendingWindows[0]).toMatchObject({
      kind: "internetAddictionDodgeRequest",
      prioritySeat: 3,
    });
    const continued = new InternetAddictionSession(
      judgment.state,
      ruleset,
      () => 1000,
    );
    pass(continued, "pass3");
    pass(continued, "pass4");
    let state = continued.state;
    while (state.scheduledEffects.length)
      state = executeNextImmediateDamageEffect(state, ruleset).state;
    expect(state.players.map((player) => player.shield)).toEqual([
      10, 10, 8, 8,
    ]);
  });

  it("reopens the same responder after a failed armor judgment without offering that armor again", () => {
    const prepared = ready("special.sp01"),
      armor = Object.values(prepared.state.cards).find(
        (card) => card.templateId === "armor.a01",
      )!,
      red = Object.values(prepared.state.cards).find(
        (card) =>
          (
            ruleset.documents.get("cards.json") as {
              items: Array<{ cardId: string; color: string }>;
            }
          ).items.find((item) => item.cardId === card.templateId)?.color ===
          "red",
      )!;
    relocate(prepared.state, armor.cardRef, "armor:2");
    relocate(prepared.state, red.cardRef, "drawPile", true);
    const useSession = use(prepared),
      window = useSession.state.pendingWindows[0]!;
    useSession.handle({
      commandId: "armor-fail",
      gameId: useSession.state.gameId,
      expectedStateRevision: useSession.state.stateRevision,
      actorUserId: "u2",
      promptId: window.promptId,
      offerId: window.legalOfferIds.find((offer) =>
        offer.includes(":armorJudgment:"),
      )!,
      cardRef: prepared.cardRef,
    });
    const judgment = new JudgmentInterventionSession(useSession.state, ruleset);
    for (let index = 0; index < 4; index += 1) {
      const current = judgment.state.pendingWindows[0]!,
        actor = judgment.state.players.find(
          (player) => player.seat === current.prioritySeat,
        )!;
      judgment.handle({
        commandId: `failed-pass:${index}`,
        gameId: judgment.state.gameId,
        expectedStateRevision: judgment.state.stateRevision,
        actorUserId: actor.userId,
        promptId: current.promptId,
        offerId: current.legalOfferIds[0]!,
      });
    }
    expect(judgment.state.pendingWindows[0]).toMatchObject({
      kind: "internetAddictionDodgeRequest",
      prioritySeat: 2,
    });
    expect(
      judgment.state.pendingWindows[0]!.legalOfferIds.some((offer) =>
        offer.includes(":armorJudgment:"),
      ),
    ).toBe(false);
  });
});
