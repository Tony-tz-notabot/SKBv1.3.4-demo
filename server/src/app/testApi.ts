import {randomUUID} from "node:crypto";
import type {IncomingMessage,ServerResponse} from "node:http";
import type {LoadedRuleset} from "../ruleset/types.js";
import {createInitialSetup,resolveInitialRedraw} from "../engine/setup.js";
import {runAutomaticScheduler} from "../engine/automaticScheduler.js";
import {validateAuthoritativeState} from "../engine/stateValidation.js";
import type {AuthoritativeGameState,Seat} from "../engine/state.js";
import type {RoomService} from "./roomService.js";
import type {AppRoom} from "./types.js";

// Agent 测试环境（SKB_TEST_MODE=1 才注册）：跳过登录/建房/选角直接进入正文，
// 提供按座位指定初始手牌、对局中注入手牌、控制牌堆顶部与权威状态摘要。

export interface TestSetupRequest {
  hands?: Record<string, string[]>;
  charactersBySeat?: Record<string, string>;
  firstSeat?: number;
  seed?: number;
  skipRedraw?: boolean;
  displayNames?: Record<string, string>;
  responseTimeSeconds?: number;
  turnTimeSeconds?: number;
}
export interface TestPlayerInfo { seat: Seat; userId: string; displayName: string; token: string; characterId: string }
export interface TestSetupResult { ok: true; gameId: string; roomId: string; roomCode: string; firstSeat: Seat; lifecycle: string; stateRevision: number; players: TestPlayerInfo[] }
export interface TestWindowSummary { promptId: string; kind: string; prioritySeat: Seat; mandatory: boolean; deadlineAt: number; timeoutPolicy: string; legalOfferIds: string[]; context: Record<string, unknown> }
export interface TestPlayerSummary {
  seat: Seat; team: "A" | "B"; characterId: string; hp: number | null; maxHp: number | null; shield: number | null; maxShield: number | null;
  ironShield: number; lifeState: string; statuses: Array<{ statusId: string; stacks: number; durationId: string | null }>; markers: Record<string, unknown>; handTemplates: string[]; equipmentTemplates: string[];
}
export interface TestStateSummary {
  gameId: string; stateRevision: number; lastEventSeq: number; lifecycle: string; round: number; activeSeat: Seat | null; phase: string | null; phaseBoundary: string | null; winnerTeam: "A" | "B" | null;
  drawPileCount: number; drawPileTopTemplates: string[]; discardAllTemplates: string[]; resolvingTemplates: string[];
  pendingWindows: TestWindowSummary[]; resolutionStackCount: number; players: TestPlayerSummary[];
  recentEvents: Array<{ eventSeq: number; stateRevision: number; eventType: string; payload: unknown }>;
}

const SEATS: Seat[] = [1, 2, 3, 4];
const DEFAULT_CHARACTERS: Record<Seat, string> = { 1: "character.knight", 2: "character.alchemist", 3: "character.ranger", 4: "character.wizard" };
const EQUIPMENT_SUFFIXES = ["weapon:1", "weapon:2", "weapon:3", "thirdWeapon", "armor", "mountOffense", "mountDefense", "talent", "boss", "judgment"];

export function roomByGameId(rooms: RoomService, gameId: string, roomId?: string | null, includeClosed = false): AppRoom | null {
  if (roomId) { const room = rooms.rooms.get(roomId); if (room?.game?.gameId === gameId && (includeClosed || room.phase !== "closed")) return room; }
  return [...rooms.rooms.values()].find(room => room.game?.gameId === gameId && (includeClosed || room.phase !== "closed")) ?? null;
}

export function findCardInstance(state: AuthoritativeGameState, templateId: string, sourceZones: string[] = ["drawPile", "discardPile"], exclude?: Set<string>): { cardRef: string; zoneRef: string } | null {
  for (const zoneRef of sourceZones) {
    const zone = state.zones[zoneRef]; if (!zone) continue;
    for (const cardRef of zone.orderedCardRefs) {
      if (exclude?.has(cardRef)) continue;
      if (state.cards[cardRef]?.templateId === templateId) return { cardRef, zoneRef };
    }
  }
  return null;
}

// 直接改权威状态移动单卡（不 bump revision、不 emit 事件），与 e2e 测试样板一致。
// 目标为 hand:N 时 zone.ownerSeat 即该座；目标为牌堆/弃牌堆时 ownerSeat 为 null。
export function moveInstanceRaw(state: AuthoritativeGameState, cardRef: string, toZoneRef: string, position: "top" | "bottom"): void {
  const card = state.cards[cardRef]; if (!card) return;
  const from = state.zones[card.zoneRef]; if (from) {
    const index = from.orderedCardRefs.indexOf(cardRef); if (index >= 0) from.orderedCardRefs.splice(index, 1);
  }
  const to = state.zones[toZoneRef]; if (!to) throw new Error(`TEST_ZONE_NOT_FOUND:${toZoneRef}`);
  if (position === "top") to.orderedCardRefs.unshift(cardRef); else to.orderedCardRefs.push(cardRef);
  const owner = to.ownerSeat;
  card.zoneRef = toZoneRef; card.ownerSeat = owner; card.controllerSeat = owner; card.faceUp = false;
}

function collect(state: AuthoritativeGameState, templates: string[]): Array<{ cardRef: string }> {
  const available: Array<{ cardRef: string }> = [];
  const used = new Set<string>();
  for (const templateId of templates) {
    const found = findCardInstance(state, templateId, ["drawPile", "discardPile"], used);
    if (!found) throw new Error(`TEST_CARD_NOT_AVAILABLE:${templateId}`);
    used.add(found.cardRef);
    available.push({ cardRef: found.cardRef });
  }
  return available;
}

// 预检全部模板可用后再动手：replace 先把现有手牌移回牌堆底，再逐张注入。全有才提交，无部分修改。
export function injectHand(state: AuthoritativeGameState, seat: Seat, templates: string[], mode: "replace" | "append"): void {
  const handZone = `hand:${seat}`;
  const available = collect(state, templates);
  if (mode === "replace") for (const cardRef of [...state.zones[handZone]!.orderedCardRefs]) moveInstanceRaw(state, cardRef, "drawPile", "bottom");
  for (const { cardRef } of available) moveInstanceRaw(state, cardRef, handZone, "bottom");
  validateAuthoritativeState(state);
}

// top 时按数组序：templates[0] 位于牌堆顶部（摸牌/判定先摸到）。
export function injectDeck(state: AuthoritativeGameState, templates: string[], position: "top" | "bottom"): void {
  const available = collect(state, templates);
  if (position === "top") for (const { cardRef } of [...available].reverse()) moveInstanceRaw(state, cardRef, "drawPile", "top");
  else for (const { cardRef } of available) moveInstanceRaw(state, cardRef, "drawPile", "bottom");
  validateAuthoritativeState(state);
}

export function summarize(room: AppRoom): TestStateSummary {
  const state = room.game!;
  const drawTop = state.zones.drawPile!.orderedCardRefs.slice(0, 5);
  const players: TestPlayerSummary[] = state.players.map(player => {
    const equipment: string[] = [];
    for (const suffix of EQUIPMENT_SUFFIXES) { const zone = state.zones[`${suffix}:${player.seat}`]; if (zone) equipment.push(...zone.orderedCardRefs); }
    return {
      seat: player.seat, team: player.team, characterId: player.characterId ?? "", hp: player.hp, maxHp: player.maxHp, shield: player.shield, maxShield: player.maxShield,
      ironShield: player.ironShield, lifeState: player.lifeState, statuses: player.statuses.map(status => ({ statusId: status.statusId, stacks: status.stacks, durationId: status.durationId })), markers: player.markers,
      handTemplates: state.zones[`hand:${player.seat}`]!.orderedCardRefs.map(ref => state.cards[ref]!.templateId),
      equipmentTemplates: equipment.map(ref => state.cards[ref]!.templateId),
    };
  });
  return {
    gameId: state.gameId, stateRevision: state.stateRevision, lastEventSeq: state.lastEventSeq, lifecycle: state.lifecycle, round: state.round, activeSeat: state.activeSeat, phase: state.phase, phaseBoundary: state.phaseBoundary, winnerTeam: state.winnerTeam,
    drawPileCount: state.zones.drawPile!.orderedCardRefs.length, drawPileTopTemplates: drawTop.map(ref => state.cards[ref]!.templateId), discardAllTemplates: [...state.zones.discardPile!.orderedCardRefs].reverse().map(ref => state.cards[ref]!.templateId),
    resolvingTemplates: state.zones.resolving?.orderedCardRefs.map(ref => state.cards[ref]!.templateId) ?? [],
    pendingWindows: state.pendingWindows.map(window => ({ promptId: window.promptId, kind: window.kind, prioritySeat: window.prioritySeat, mandatory: window.mandatory, deadlineAt: window.deadlineAt, timeoutPolicy: window.timeoutPolicy, legalOfferIds: window.legalOfferIds, context: window.context ?? {} })),
    resolutionStackCount: state.resolutionStack.length, players,
    recentEvents: state.history.domainEvents.slice(-30).map(event => ({ eventSeq: event.eventSeq, stateRevision: event.stateRevision, eventType: event.eventType, payload: event.payload })),
  };
}

async function handleSetup(deps: { rooms: RoomService; ruleset: LoadedRuleset }, body: TestSetupRequest, createdRooms: Set<string>): Promise<TestSetupResult> {
  for (const oldRoomId of createdRooms) deps.rooms.rooms.delete(oldRoomId);
  createdRooms.clear();
  const firstSeat = (body.firstSeat as Seat) ?? 1;
  const seed = typeof body.seed === "number" ? body.seed : (Math.floor(Math.random() * 0xffffffff) >>> 0);
  const sessions = SEATS.map(seat => deps.rooms.createSession(body.displayNames?.[String(seat)] ?? `测试玩家${seat}`));
  const usersBySeat = {} as Record<Seat, string>;
  const characterIdsBySeat = {} as Record<Seat, string>;
  for (const [index, seat] of SEATS.entries()) {
    usersBySeat[seat] = sessions[index]!.userId;
    characterIdsBySeat[seat] = typeof body.charactersBySeat?.[String(seat)] === "string" ? body.charactersBySeat[String(seat)]! : DEFAULT_CHARACTERS[seat]!;
  }
  const gameId = randomUUID();
  const responseSeconds = Number.isFinite(Number(body.responseTimeSeconds)) ? Number(body.responseTimeSeconds) : 30;
  const turnSeconds = Number.isFinite(Number(body.turnTimeSeconds)) ? Number(body.turnTimeSeconds) : 60;
  let game = createInitialSetup(deps.ruleset, { gameId, firstSeat, seed, usersBySeat, characterIdsBySeat, setupStartedAt: Date.now() });
  // 先推进到正文的首个真实窗口（重摸→scheduler），再注入指定手牌，避免摸牌污染指定组合。
  if (body.skipRedraw !== false) {
    for (const seat of SEATS) game = resolveInitialRedraw(game, seat, false, deps.ruleset).state;
    game = runAutomaticScheduler(game, deps.ruleset, () => Date.now() + responseSeconds * 1000, () => Date.now() + turnSeconds * 1000).state;
  }
  if (body.hands) {
    for (const [seatKey, templates] of Object.entries(body.hands)) {
      const seat = Number(seatKey) as Seat;
      if (!SEATS.includes(seat)) throw new Error("TEST_SEAT_INVALID");
      injectHand(game, seat, Array.isArray(templates) ? templates.map(String) : [], "replace");
    }
  }
  const users = {} as Record<Seat, { userId: string; displayName: string }>;
  for (const [index, seat] of SEATS.entries()) users[seat] = { userId: sessions[index]!.userId, displayName: sessions[index]!.displayName };
  const room = deps.rooms.createTestRoom(game, users, { turnTimeSeconds: turnSeconds, responseTimeSeconds: responseSeconds });
  createdRooms.add(room.roomId);
  return {
    ok: true, gameId, roomId: room.roomId, roomCode: room.roomCode, firstSeat, lifecycle: game.lifecycle, stateRevision: game.stateRevision,
    players: SEATS.map((seat, index) => ({ seat, userId: sessions[index]!.userId, displayName: sessions[index]!.displayName, token: sessions[index]!.token, characterId: game.players.find(p => p.seat === seat)!.characterId! })),
  };
}

export function createTestApi(deps: { rooms: RoomService; ruleset: LoadedRuleset; broadcast: () => void }) {
  const createdRooms = new Set<string>();
  const readBody = (req: IncomingMessage): Promise<Record<string, unknown>> => new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => { body += String(chunk); if (body.length > 1_000_000) reject(new Error("TEST_BODY_TOO_LARGE")); });
    req.on("end", () => { try { resolve(body ? JSON.parse(body) as Record<string, unknown> : {}); } catch { reject(new Error("TEST_JSON_INVALID")); } });
    req.on("error", reject);
  });
  return {
    async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
      if (!req.url?.startsWith("/api/test/")) return false;
      const url = new URL(req.url, "http://localhost");
      const path = url.pathname;
      const method = req.method ?? "GET";
      const send = (status: number, data: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
      try {
        if (method === "GET" && path === "/api/test/state") {
          const room = roomByGameId(deps.rooms, url.searchParams.get("gameId") ?? "", url.searchParams.get("roomId"), url.searchParams.get("closed") === "1");
          if (!room?.game) { send(404, { ok: false, error: "TEST_ROOM_NOT_FOUND" }); return true; }
          send(200, summarize(room)); return true;
        }
        if (method === "POST" && path === "/api/test/setup") {
          const body = await readBody(req) as TestSetupRequest;
          send(200, await handleSetup(deps, body, createdRooms)); return true;
        }
        if (method === "POST" && path === "/api/test/hand") {
          const body = await readBody(req);
          const room = roomByGameId(deps.rooms, String(body.gameId ?? ""), body.roomId as string | undefined);
          if (!room?.game) { send(404, { ok: false, error: "TEST_ROOM_NOT_FOUND" }); return true; }
          const seat = Number(body.seat) as Seat;
          if (!SEATS.includes(seat)) throw new Error("TEST_SEAT_INVALID");
          injectHand(room.game, seat, Array.isArray(body.templates) ? body.templates.map(String) : [], body.mode === "append" ? "append" : "replace");
          deps.broadcast();
          send(200, summarize(room)); return true;
        }
        if (method === "POST" && path === "/api/test/deck") {
          const body = await readBody(req);
          const room = roomByGameId(deps.rooms, String(body.gameId ?? ""), body.roomId as string | undefined);
          if (!room?.game) { send(404, { ok: false, error: "TEST_ROOM_NOT_FOUND" }); return true; }
          injectDeck(room.game, Array.isArray(body.templates) ? body.templates.map(String) : [], body.mode === "bottom" ? "bottom" : "top");
          deps.broadcast();
          send(200, summarize(room)); return true;
        }
        send(404, { ok: false, error: "TEST_ROUTE_NOT_FOUND" }); return true;
      } catch (error) {
        send(400, { ok: false, error: error instanceof Error ? error.message : "TEST_UNKNOWN" }); return true;
      }
    },
  };
}

export type TestApi = ReturnType<typeof createTestApi>;
