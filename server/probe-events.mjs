// SKB WS 事件流探测：真实链路中客户端能否收到 ATTACK_DECLARED 等演示事件。
import WebSocket from "ws";

const PORT = 8799;
const api = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1) setup
  const body = JSON.stringify({ charactersBySeat: { 1: "character.knight", 2: "character.ranger", 3: "character.shaman", 4: "character.druid" }, seed: 7, skipRedraw: true, responseTimeSeconds: 60, turnTimeSeconds: 120 });
  const setup = await (await fetch(`${api}/api/test/setup`, { method: "POST", headers: { "content-type": "application/json" }, body })).json();
  console.log("setup ok:", setup.ok, "gameId:", setup.gameId, "firstSeat:", setup.firstSeat);
  const players = setup.players;
  // 2) connect 4 ws
  const sockets = [];
  const snapshots = new Map();
  const events = [];
  const results = [];
  for (const p of players) {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws?token=${p.token}`);
    sockets.push(ws);
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === "MESSAGE" && msg.channel === "game" && msg.message?.type === "GAME_SNAPSHOT") {
        snapshots.set(p.seat, msg.message);
      } else if (msg.type === "MESSAGE" && msg.channel === "game" && msg.message?.type === "PRESENTATION_EVENT") {
        events.push({ seat: p.seat, ev: msg.message });
      } else if (msg.type === "COMMAND_RESULT" && msg.channel === "game") {
        results.push({ seat: p.seat, result: msg.message });
      }
    });
  }
  await sleep(1500);
  console.log("snapshots received:", snapshots.size);
  const s1 = snapshots.get(1);
  if (!s1) { console.log("NO SNAPSHOT for seat1"); process.exit(1); }
  console.log("seat1 lifecycle:", s1.lifecycle ?? "inProgress?", "activeSeat:", s1.publicView.activeSeat, "phase:", s1.publicView.phase);
  // 3) 出牌阶段：找到攻击报价（declareAttack）并执行（手刀：无需卡）
  const interaction = s1.interaction;
  console.log("seat1 prompt kind:", interaction.prompt?.kind, "offers:", interaction.offers?.map((o) => `${o.offerId}:${o.kind}`).join(","));
  // 注入杀牌供攻击费用使用
  const handRes = await (await fetch(`${api}/api/test/hand`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gameId: setup.gameId, seat: 1, templates: ["basic.kill.white"], mode: "append" }) })).json();
  console.log("inject hand:", JSON.stringify(handRes));
  await sleep(800);
  const s1b = snapshots.get(1);
  const kill = s1b?.privateView?.hand?.find((c) => String(c.templateId).startsWith("basic.kill"));
  console.log("kill card in hand:", kill ? kill.ref : "NOT FOUND");
  const attackOffer = interaction.offers?.find((o) => o.kind === "declareAttack");
  if (!attackOffer || !kill) { console.log("NO attack offer or kill card"); process.exit(0); }
  const targetRefs = attackOffer.selectionSpecs?.find((sp) => sp.kind === "targets")?.legalRefs ?? attackOffer.legalTargetRefs ?? [];
  console.log("attack offer:", attackOffer.offerId, "legal targets:", targetRefs.join(","));
  const target = targetRefs[0];
  const command = { type: "GAME_COMMAND", commandId: "probe-attack-2", gameId: s1b.gameId, expectedStateRevision: s1b.stateRevision, command: "EXECUTE_OFFER", promptId: s1b.interaction.prompt.promptId, offerId: attackOffer.offerId, payload: { selections: { cards: [kill.ref], targets: target ? [target] : [] } } };
  sockets[0].send(JSON.stringify({ type: "COMMAND", channel: "game", command }));
  await sleep(3000);
  console.log("command results:", JSON.stringify(results));
  // 4) 汇总：按 eventType 统计
  const byType = {};
  for (const { seat, ev } of events) {
    const k = ev.eventType;
    byType[k] = (byType[k] ?? 0) + 1;
    if (k.startsWith("ATTACK") || k === "DAMAGE_SEGMENT_APPLIED" || k === "RESPONSE_WINDOW_OPENED") {
      console.log(`seat${seat} ${k} payload=${JSON.stringify(ev.payload)} opId=${ev.operationId ?? "NONE"}`);
    }
  }
  console.log("event type counts (all seats):", JSON.stringify(byType));
  console.log("总事件数:", events.length);
  process.exit(0);
}
main().catch((e) => { console.error("PROBE ERROR:", e); process.exit(1); });
