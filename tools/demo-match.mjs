// demo-match.mjs — 用真实账户（logtest1 为 1 号座）在运行中的 SKB 服务器上打一局完整对局。
// 复用 fullMatch.test.ts 的驱动模式：真实 WS 房间命令 + 游戏命令 + AI 决策循环，直到分出胜负。
const BASE = process.env.SKB_URL ?? "http://127.0.0.1:8787";
const WS = BASE.replace(/^http/, "ws");
const NativeWS = globalThis.WebSocket;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor(socket) { this.socket = socket; this.messages = []; this.open = new Promise((res, rej) => { socket.addEventListener("open", () => res()); socket.addEventListener("error", () => rej(new Error("ws error"))); }); socket.addEventListener("message", (ev) => this.messages.push(JSON.parse(String(ev.data)))); }
  send(m) { this.socket.send(JSON.stringify(m)); }
  close() { try { this.socket.close(); } catch {} }
}
const starts = (c) => c.messages.length;
async function waitFor(client, from, pred, timeout = 20000) {
  const dl = Date.now() + timeout;
  while (Date.now() < dl) { const e = client.messages.slice(from).find(pred); if (e) return e; await delay(20); }
  const hist = {};
  for (const m of client.messages.slice(from)) { const k = `${m.type}/${m.channel}/${m.message?.type}`; hist[k] = (hist[k] ?? 0) + 1; }
  throw new Error("wait timeout: " + JSON.stringify(hist) + " tail=" + client.messages.slice(-3).map((m) => JSON.stringify(m).slice(0, 200)).join("\n"));
}
async function command(client, msg, channel) {
  const from = starts(client); client.send({ type: "COMMAND", channel, command: msg });
  const e = await waitFor(client, from, (m) => m.type === "COMMAND_RESULT" && m.channel === channel && m.message.commandId === msg.commandId);
  if (!String(e.message.type).endsWith("ACCEPTED")) throw new Error(`rejected ${e.message.reasonCode} cmd=${msg.command} prompt=${String(msg.promptId).slice(0, 14)}`);
  return e.message;
}
const latestRoom = (c) => c.messages.filter((m) => m.type === "MESSAGE" && m.channel === "room" && m.message.type === "ROOM_SNAPSHOT").at(-1)?.message;
const latestSnapWithPrompt = (c, seat, promptId) => c.messages.filter((m) => m.type === "MESSAGE" && m.channel === "game" && m.message.type === "GAME_SNAPSHOT" && m.message.viewer?.seat === seat && m.message.interaction?.prompt?.promptId === promptId).at(-1)?.message;
const latestSnaps = (c, seat) => c.messages.filter((m) => m.type === "MESSAGE" && m.channel === "game" && m.message.type === "GAME_SNAPSHOT" && m.message.viewer?.seat === seat).map((m) => m.message);

function choose(snap) {
  const offers = snap.interaction.offers ?? [];
  if (!offers.length) return null;
  const seat = snap.viewer.seat;
  const attack = offers.find((o) => String(o.offerId).includes("attack"));
  if (attack) {
    const specs = attack.selectionSpecs ?? [], kill = specs.find((s) => s.key === "killCards"), targets = specs.find((s) => s.key === "targets"), confirm = specs.find((s) => s.key === "confirm");
    const enemy = targets?.legalRefs?.find((r) => !r.endsWith(`seat_${seat}`)) ?? targets?.legalRefs?.[0];
    if (kill?.legalRefs?.[0] && enemy) { const selections = { killCards: [kill.legalRefs[0]], targets: [enemy] }; if (confirm) selections.confirm = [true]; return { offerId: attack.offerId, selections }; }
  }
  const gain = offers.find((o) => String(o.offerId).includes("equip") || String(o.offerId).includes("synthesis"));
  if (gain) { const spec = gain.selectionSpecs?.find((s) => s.legalRefs?.length); if (spec) { const count = Math.min(Number(spec.min ?? 1) || 1, spec.legalRefs.length); return { offerId: gain.offerId, selections: { [spec.key]: spec.legalRefs.slice(0, count) } }; } }
  const pass = offers.find((o) => String(o.offerId).includes(":pass:") || String(o.offerId).includes("finish"));
  if (pass) return { offerId: pass.offerId, selections: {} };
  const first = offers.find((o) => o.selectionSpecs?.length);
  if (first) { const spec = first.selectionSpecs.find((s) => s.legalRefs?.length); if (spec) return { offerId: first.offerId, selections: { [spec.key]: spec.legalRefs.slice(0, Math.min(Number(spec.min ?? 1) || 1, spec.legalRefs.length)) } }; return { offerId: first.offerId, selections: {} }; }
  return { offerId: offers[0].offerId, selections: {} };
}
function pickPreselectSlot(snap) {
  const slots = snap.privateView?.preselectableWeaponSlots;
  if (!slots?.length) return null;
  const me = snap.publicView?.players?.find((p) => p.seat === snap.viewer.seat);
  const keyOf = (slot) => { if (slot.startsWith("thirdWeapon:")) return "thirdWeapon"; const m = /^weapon:(\d):/.exec(slot); return m ? `weapon${m[1]}` : null; };
  for (const slot of slots) { const key = keyOf(slot); if (key && me?.equipmentSlots?.[key]?.cardRef) return slot; }
  return slots[0] ?? null;
}

const session = async (username, password) => { const r = await fetch(`${BASE}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password, displayName: username }) }); const s = await r.json(); if (!s.token) throw new Error(`session failed ${username}: ${JSON.stringify(s)}`); return s; };

const settings = { roomName: "演示对局", allowGuests: true, allowSpectators: true, turnTimeSeconds: 60, responseTimeSeconds: 30, reserveTimeSeconds: 30, rulesetVersion: "1.3.4", dismantleBossEnabled: true };
const avoid = new Set(["character.punching_bag", "character.interdimensional_traveler", "character.general", "character.engineer", "character.giant_slime"]);

const stamp = Date.now().toString(36);
const accounts = [
  { username: "logtest1", password: "pass1234" },
  { username: `demo2${stamp}`, password: "test123" },
  { username: `demo3${stamp}`, password: "test123" },
  { username: `demo4${stamp}`, password: "test123" },
];
const sessions = [];
for (const a of accounts) sessions.push(await session(a.username, a.password));
console.log("已登录:", sessions.map((s, i) => `${i + 1}号座=${s.displayName}`).join(", "));
const clients = sessions.map((s) => new Client(new NativeWS(`${WS}/ws?token=${encodeURIComponent(s.token)}`)));
await Promise.all(clients.map((c) => c.open));

try {
  const created = await command(clients[0], { type: "ROOM_COMMAND", commandId: `c${stamp}-create`, command: "CREATE_ROOM", payload: { settings, password: null } }, "room");
  if (created.type !== "ROOM_COMMAND_ACCEPTED") throw new Error("create failed");
  const roomSnap = (await waitFor(clients[0], 0, (m) => m.type === "MESSAGE" && m.channel === "room" && m.message.type === "ROOM_SNAPSHOT")).message;
  const roomCode = roomSnap.roomCode, roomId = roomSnap.roomId;
  console.log("房间已创建，房号:", roomCode);
  let rev = roomSnap.roomRevision;
  for (let i = 1; i < 4; i++) rev = (await command(clients[i], { type: "ROOM_COMMAND", commandId: `c${stamp}-join${i}`, command: "JOIN_ROOM", payload: { roomCode, password: null, asSpectator: false } }, "room")).roomRevision;
  for (let i = 0; i < 4; i++) rev = (await command(clients[i], { type: "ROOM_COMMAND", commandId: `c${stamp}-ready${i}`, roomId, expectedRoomRevision: rev, command: "SET_READY", payload: { ready: true } }, "room")).roomRevision;
  rev = (await command(clients[0], { type: "ROOM_COMMAND", commandId: `c${stamp}-start`, roomId, expectedRoomRevision: rev, command: "START_GAME", payload: {} }, "room")).roomRevision;
  const selection = [];
  for (let i = 0; i < 4; i++) selection.push((await waitFor(clients[i], 0, (m) => m.type === "MESSAGE" && m.channel === "room" && m.message.type === "ROOM_SNAPSHOT" && m.message.phase === "characterSelection" && m.message.characterSelection)).message);
  for (let i = 0; i < 4; i++) { const pick = selection[i].characterSelection.candidates.find((c) => !avoid.has(c.characterId)) ?? selection[i].characterSelection.candidates[0]; rev = (await command(clients[i], { type: "ROOM_COMMAND", commandId: `c${stamp}-lock${i}`, roomId, expectedRoomRevision: rev, command: "LOCK_CHARACTER", payload: { characterId: pick.characterId } }, "room")).roomRevision; }
  const setup = [];
  for (let i = 0; i < 4; i++) setup.push((await waitFor(clients[i], 0, (m) => m.type === "MESSAGE" && m.channel === "game" && m.message.type === "SETUP_SNAPSHOT")).message);
  let srev = setup[0].stateRevision;
  for (let i = 0; i < 4; i++) srev = (await command(clients[i], { type: "GAME_COMMAND", commandId: `c${stamp}-redraw${i}`, gameId: setup[i].gameId, expectedStateRevision: srev, promptId: setup[i].interaction.prompt.promptId, offerId: setup[i].interaction.offers[0].offerId, command: "EXECUTE_OFFER", payload: { selections: { confirm: [false] } } }, "game")).stateRevision;
  console.log("选角完成，对局开始。角色:", setup.map((s, i) => `${i + 1}号=${s.publicView?.players?.find((p) => p.seat === i + 1)?.characterId ?? "?"}`).join(", "));

  // ---- 自动对局主循环（真实命令，不改状态）----
  const deadline = Date.now() + 300000; let guard = 0, totalCommands = 0, attackCount = 0, winner = null, lastWinSeen = 0, curRev = srev;
  const waitSnapAt = async (seat, promptId, rev) => { const from = clients[seat - 1].messages.length, dl = Date.now() + 8000; while (Date.now() < dl) { const s = clients[seat - 1].messages.slice(from).filter((m) => m.type === "MESSAGE" && m.channel === "game" && m.message.type === "GAME_SNAPSHOT" && m.message.viewer?.seat === seat && m.message.interaction?.prompt?.promptId === promptId && m.message.stateRevision === rev); if (s.length) return s.at(-1).message; await delay(20); } return null; };
  for (; Date.now() < deadline && guard < 10000; guard += 1) {
    // 找当前有窗口的座位
    let active = null;
    for (let seat = 1; seat <= 4; seat++) {
      const last = latestSnaps(clients[seat - 1], seat).at(-1);
      if (last?.interaction?.prompt) { active = { seat, promptId: last.interaction.prompt.promptId, gameId: last.gameId }; break; }
      if (last?.publicView?.winnerTeam) { winner = last.publicView.winnerTeam; lastWinSeen = Date.now(); }
    }
    if (active) {
      const snap = await waitSnapAt(active.seat, active.promptId, curRev);
      if (!snap) { await delay(30); continue; }
      const decision = choose(snap);
      if (!decision) throw new Error(`no offer for window ${snap.interaction.prompt.kind} seat ${active.seat}: ${JSON.stringify((snap.interaction.offers ?? []).map((o) => o.offerId))}`);
      if (snap.interaction.prompt.kind === "playPhaseAction" && snap.privateView?.preselectedWeaponSlot == null) {
        const slot = pickPreselectSlot(snap);
        if (slot) { const result = await command(clients[active.seat - 1], { type: "GAME_COMMAND", commandId: `d${stamp}-presel${guard}`, gameId: active.gameId, expectedStateRevision: curRev, command: "SET_PRESELECTION", payload: { weaponSlot: slot, modeId: null } }, "game"); curRev = result.stateRevision; continue; }
      }
      const result = await command(clients[active.seat - 1], { type: "GAME_COMMAND", commandId: `d${stamp}-${guard}`, gameId: active.gameId, expectedStateRevision: curRev, promptId: active.promptId, offerId: decision.offerId, command: "EXECUTE_OFFER", payload: { selections: decision.selections } }, "game");
      curRev = result.stateRevision;
      totalCommands += 1; if (String(decision.offerId).includes("attack")) attackCount += 1;
      const newSnap = latestSnaps(clients[active.seat - 1], active.seat).at(-1);
      if (newSnap?.publicView?.winnerTeam) { winner = newSnap.publicView.winnerTeam; lastWinSeen = Date.now(); }
    } else if (winner && Date.now() - lastWinSeen > 1500) {
      break;
    } else {
      await delay(30);
    }
  }
  if (!winner) throw new Error(`no winner after ${guard} loops / ${totalCommands} commands / ${attackCount} attacks`);
  console.log(`\n对局结束：${winner}队 胜利（${guard} 轮 / ${totalCommands} 命令 / ${attackCount} 次攻击）`);
  await delay(1000);
  const finalRoomSnap = latestRoom(clients[0]);
  console.log("游戏 ID:", roomSnap?.gameId ?? "(房间已解散)");
} finally {
  for (const c of clients) c.close();
}
