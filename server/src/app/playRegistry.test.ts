import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { runAutomaticScheduler } from "../engine/automaticScheduler.js";
import { createInitialSetup, resolveInitialRedraw } from "../engine/setup.js";
import { setWeaponPreselection } from "../engine/preselection.js";
import type { AuthoritativeGameState, Seat } from "../engine/state.js";
import { GameService } from "./gameService.js";
import { GameProjector } from "./projection.js";
import { playOffers } from "./playRegistry.js";
import { validateProtocol } from "./protocol.js";
import type { AppRoom, AppSettings, AppUser } from "./types.js";

let ruleset: LoadedRuleset;

const settings: AppSettings = {
  roomName: "注册表测试",
  allowGuests: true,
  allowSpectators: false,
  turnTimeSeconds: 60,
  responseTimeSeconds: 20,
  reserveTimeSeconds: 30,
  rulesetVersion: "1.3.4",
  dismantleBossEnabled: true,
};

const users: Record<Seat, AppUser> = {
  1: { userId: "u1", displayName: "一号" },
  2: { userId: "u2", displayName: "二号" },
  3: { userId: "u3", displayName: "三号" },
  4: { userId: "u4", displayName: "四号" },
};

beforeAll(async () => {
  ruleset = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});

function openedState(seed = 101, seat1 = "character.knight"): AuthoritativeGameState {
  let state = createInitialSetup(ruleset, {
    gameId: `registry-${seed}`,
    firstSeat: 1,
    seed,
    usersBySeat: {
      1: users[1]!.userId,
      2: users[2]!.userId,
      3: users[3]!.userId,
      4: users[4]!.userId,
    },
    characterIdsBySeat: {
      1: seat1,
      2: "character.alchemist",
      3: "character.ranger",
      4: "character.wizard",
    },
  });
  for (const seat of [1, 2, 3, 4] as const)
    state = resolveInitialRedraw(state, seat, false, ruleset).state;
  const scheduled = runAutomaticScheduler(state, ruleset, () => 21000);
  state = scheduled.state;
  if (state.phase !== "play")
    throw new Error(`expected play phase, got ${state.phase}`);
  return state;
}

function refsByTemplate(state: AuthoritativeGameState, prefix: string): string[] {
  return Object.values(state.cards)
    .filter((card) => card.templateId.startsWith(prefix))
    .map((card) => card.cardRef);
}

function moveCard(
  state: AuthoritativeGameState,
  cardRef: string,
  toZoneRef: string,
  owner: Seat = 1,
): void {
  const card = state.cards[cardRef]!;
  const from = state.zones[card.zoneRef]!;
  const index = from.orderedCardRefs.indexOf(cardRef);
  if (index < 0) throw new Error("card not in source zone");
  from.orderedCardRefs.splice(index, 1);
  const to = state.zones[toZoneRef]!;
  to.orderedCardRefs.push(cardRef);
  card.zoneRef = toZoneRef;
  card.ownerSeat = to.ownerSeat ?? owner;
  card.controllerSeat = to.ownerSeat ?? owner;
  card.faceUp = !toZoneRef.startsWith("hand:");
}

function makeRoom(state: AuthoritativeGameState): AppRoom {
  return {
    roomId: state.gameId,
    roomCode: "ABCDEF",
    revision: 1,
    phase: "inGame",
    settings,
    passwordHash: null,
    players: state.players.map((player) => ({
      userId: player.userId,
      displayName: users[player.seat]!.displayName,
      seat: player.seat,
      team: player.team,
      isHost: player.seat === 1,
      ready: true,
      connection: "online",
      latencyMs: null,
      selectionState: "revealed",
      candidates: [],
      preselectedCharacterId: null,
      lockedCharacterId: null,
      selectionDeadlineAt: null,
    })),
    spectators: [],
    chat: [],
    gameChat: [],
    game: state,
    createdAt: 0,
    updatedAt: 0,
  };
}

function expectSnapshotValid(room: AppRoom, userId: string): void {
  const snapshot = new GameProjector(ruleset).game(room, userId);
  expect(validateProtocol("game", snapshot)).toEqual({ ok: true });
}

function gameCommand(
  room: AppRoom,
  commandId: string,
  offerId: string,
  selections: Record<string, Array<string | number | boolean>>,
) {
  return {
    type: "GAME_COMMAND",
    commandId,
    gameId: room.game!.gameId,
    expectedStateRevision: room.game!.stateRevision,
    promptId: room.game!.pendingWindows[0]!.promptId,
    offerId,
    command: "EXECUTE_OFFER",
    payload: { selections },
  };
}

function submitOffer(
  room: AppRoom,
  service: GameService,
  user: AppUser,
  offerId: string,
  selections: Record<string, Array<string | number | boolean>>,
  commandId: string,
) {
  const before = room.game!.stateRevision;
  const command = gameCommand(room, commandId, offerId, selections);
  const first = service.handle(room, user, command);
  expect(first.accepted).toBe(true);
  expect(service.handle(room, user, command)).toEqual(first);
  expect(room.game!.stateRevision).toBeGreaterThan(before);
  expectSnapshotValid(room, user.userId);
  return first;
}

describe("playRegistry real play-phase adapters", () => {
  it("accepts a hand-knife attack through GameService and keeps the response chain stable", () => {
    let state = openedState(101);
    state = setWeaponPreselection(state, 1, "weapon:1:1", null, ruleset).state;
    const kill = refsByTemplate(state, "basic.kill.")[0]!;
    moveCard(state, kill, "hand:1");
    const room = makeRoom(state);
    const service = new GameService(ruleset, () => 1000);
    expectSnapshotValid(room, "u1");
    const offer = playOffers(state, ruleset, 1, "u1", () => 21000).find((item) =>
      item.offerId.includes("attack"),
    )!;
    expect(offer).toBeTruthy();
    const killRef = Array.isArray(offer.legalKillCardRefs)
      ? (offer.legalKillCardRefs as string[])[0]!
      : kill;
    submitOffer(
      room,
      service,
      users[1]!,
      offer.offerId,
      { killCards: [`public:${killRef}`], targets: ["public:seat_2"] },
      "hand-knife-1",
    );
  });

  it("accepts a weapon attack through GameService", () => {
    let state = openedState(102);
    const weapon = refsByTemplate(state, "weapon.w06")[0]!;
    const kill = refsByTemplate(state, "basic.kill.")[0]!;
    moveCard(state, weapon, "weapon:1:1");
    moveCard(state, kill, "hand:1");
    state = setWeaponPreselection(state, 1, "weapon:1:1", "default", ruleset).state;
    const room = makeRoom(state);
    const service = new GameService(ruleset, () => 1000);
    const offer = playOffers(state, ruleset, 1, "u1", () => 21000).find((item) =>
      item.offerId.includes("attack"),
    )!;
    expect(offer).toBeTruthy();
    const killRef = Array.isArray(offer.legalKillCardRefs)
      ? (offer.legalKillCardRefs as string[])[0]!
      : kill;
    submitOffer(
      room,
      service,
      users[1]!,
      offer.offerId,
      { killCards: [`public:${killRef}`], targets: ["public:seat_2"] },
      "weapon-attack-1",
    );
  });

  it("uses a potion through the registry and applies recovery", () => {
    const state = openedState(103);
    state.players[0]!.hp = 1;
    const potion = refsByTemplate(state, "basic.potion.")[0]!;
    moveCard(state, potion, "hand:1");
    const room = makeRoom(state);
    const service = new GameService(ruleset, () => 1000);
    const offer = playOffers(state, ruleset, 1, "u1", () => 21000).find((item) =>
      item.offerId.includes("potion"),
    )!;
    expect(offer).toBeTruthy();
    const cardRef = String(offer.cardRef);
    submitOffer(
      room,
      service,
      users[1]!,
      offer.offerId,
      { cards: [`public:${cardRef}`] },
      "potion-1",
    );
    expect(room.game!.players[0]!.hp).toBe(3);
  });

  it("equips a weapon through the registry", () => {
    const state = openedState(104);
    const weapon = refsByTemplate(state, "weapon.w06")[0]!;
    moveCard(state, weapon, "hand:1");
    const room = makeRoom(state);
    const service = new GameService(ruleset, () => 1000);
    const offer = playOffers(state, ruleset, 1, "u1", () => 21000).find((item) =>
      item.offerId.includes("equip"),
    )!;
    expect(offer).toBeTruthy();
    const cardRef = String(offer.cardRef);
    submitOffer(
      room,
      service,
      users[1]!,
      offer.offerId,
      { cards: [`public:${cardRef}`] },
      "equip-1",
    );
    expect(room.game!.cards[cardRef]!.zoneRef).toBe("weapon:1:1");
  });

  it("equips armor through the registry (offer flows from playOffers and lands in armor zone)", () => {
    const state = openedState(109);
    const armor = refsByTemplate(state, "armor.a01")[0]!;
    moveCard(state, armor, "hand:1");
    const room = makeRoom(state);
    const service = new GameService(ruleset, () => 1000);
    const offer = playOffers(state, ruleset, 1, "u1", () => 21000).find((item) =>
      item.offerId.includes("equip") && item.cardRef === armor,
    )!;
    expect(offer, "出牌阶段应生成防具装备 offer").toBeTruthy();
    const cardRef = String(offer.cardRef);
    submitOffer(
      room,
      service,
      users[1]!,
      offer.offerId,
      { cards: [`public:${cardRef}`] },
      "equip-armor-1",
    );
    expect(room.game!.cards[cardRef]!.zoneRef, "装备防具应落入 armor:1").toBe("armor:1");
  });

  it("discards an equipped weapon through the registry", () => {
    const state = openedState(105);
    const weapon = refsByTemplate(state, "weapon.w06")[0]!;
    moveCard(state, weapon, "weapon:1:1");
    const room = makeRoom(state);
    const service = new GameService(ruleset, () => 1000);
    const offer = playOffers(state, ruleset, 1, "u1", () => 21000).find((item) =>
      item.offerId.includes("discard"),
    )!;
    expect(offer).toBeTruthy();
    const cardRef = String(offer.cardRef);
    submitOffer(
      room,
      service,
      users[1]!,
      offer.offerId,
      { cards: [`public:${cardRef}`] },
      "discard-1",
    );
    expect(room.game!.cards[cardRef]!.zoneRef).toBe("discardPile");
  });

  it("synthesizes W26 through the registry", () => {
    const state = openedState(106);
    const hammer = refsByTemplate(state, "weapon.w25")[0]!;
    const explosive = refsByTemplate(state, "weapon.w04")[0]!;
    moveCard(state, hammer, "hand:1");
    moveCard(state, explosive, "hand:1");
    const room = makeRoom(state);
    const service = new GameService(ruleset, () => 1000);
    const offer = playOffers(state, ruleset, 1, "u1", () => 21000).find((item) =>
      item.offerId.includes("synthesis"),
    )!;
    expect(offer).toBeTruthy();
    const materialRefs = Array.isArray(offer.legalCardRefs)
      ? (offer.legalCardRefs as string[])
      : [hammer, explosive];
    submitOffer(
      room,
      service,
      users[1]!,
      offer.offerId,
      { cards: materialRefs.map((ref) => `public:${ref}`) },
      "synthesis-1",
    );
    const product = Object.values(room.game!.cards).find(
      (card) =>
        card.templateId === "weapon.w26" &&
        card.runtime.generated === true &&
        card.zoneRef === "hand:1",
    );
    expect(product).toBeTruthy();
  });

  it("uses alchemist toxic reagent through the registry", () => {
    const state = openedState(107, "character.alchemist");
    const green = refsByTemplate(state, "basic.").find(
      (ref) => state.cards[ref]!.templateId === "basic.potion.green",
    )!;
    moveCard(state, green, "hand:1");
    const room = makeRoom(state);
    const service = new GameService(ruleset, () => 1000);
    const offer = playOffers(state, ruleset, 1, "u1", () => 21000).find((item) =>
      item.offerId.includes("skill.alchemist.toxic_reagent"),
    )!;
    expect(offer).toBeTruthy();
    const cardRef = Array.isArray(offer.legalCardRefs)
      ? (offer.legalCardRefs as string[])[0]!
      : green;
    submitOffer(
      room,
      service,
      users[1]!,
      offer.offerId,
      { cards: [`public:${cardRef}`], targets: ["public:seat_2"] },
      "toxic-1",
    );
  });

  it("rejects stale revisions and illegal selections without changing state", () => {
    const state = openedState(108);
    const potion = refsByTemplate(state, "basic.potion.")[0]!;
    moveCard(state, potion, "hand:1");
    const room = makeRoom(state);
    const service = new GameService(ruleset, () => 1000);
    const offer = playOffers(state, ruleset, 1, "u1", () => 21000).find((item) =>
      item.offerId.includes("potion"),
    )!;
    const cardRef = String(offer.cardRef);
    const before = room.game!.stateRevision;
    const stale = service.handle(room, users[1]!, {
      ...gameCommand(room, "stale-1", offer.offerId, { cards: [`public:${cardRef}`] }),
      expectedStateRevision: 0,
    });
    expect(stale).toMatchObject({ accepted: false, reasonCode: "STALE_REVISION" });
    expect(room.game!.stateRevision).toBe(before);

    const illegal = service.handle(room, users[1]!, {
      ...gameCommand(room, "illegal-1", offer.offerId, { cards: ["public:missing"] }),
      expectedStateRevision: room.game!.stateRevision,
    });
    expect(illegal.accepted).toBe(false);
    expect(room.game!.stateRevision).toBe(before);
  });
});
