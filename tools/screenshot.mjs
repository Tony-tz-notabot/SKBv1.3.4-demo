// screenshot.mjs — Edge headless + CDP：打开 ?test=1，驱动一局攻击，截取中央战斗区动画各阶段。
// 用法：node tools/screenshot.mjs（需服务器已在 8787 运行、客户端已构建）
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CDP_PORT = 9223;
const BASE = "http://localhost:8787";
const OUT_DIR = resolve(process.cwd(), "server", "data", "shots");
mkdirSync(OUT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = resolve(process.cwd(), "server", "data", "shots-edge-profile");
mkdirSync(profile, { recursive: true });
const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--window-size=1400,900", "about:blank"], { stdio: "ignore" });
const cleanup = () => { try { edge.kill(); } catch {} };

class CDP {
  constructor(wsUrl) { this.ws = new WebSocket(wsUrl); this.id = 0; this.pending = new Map(); this.ws.onmessage = (ev) => { const m = JSON.parse(String(ev.data)); if (m.id) { const p = this.pending.get(m.id); if (p) { this.pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } } }; this.open = new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = () => rej(new Error("cdp ws error")); }); }
  async call(method, params = {}) { await this.open; const id = ++this.id; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(expression) { const r = await this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error("eval: " + JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result?.value; }
  async shot(name) { const r = await this.call("Page.captureScreenshot", { format: "png" }); const p = resolve(OUT_DIR, name); writeFileSync(p, Buffer.from(r.data, "base64")); console.log("shot:", name); return p; }
  close() { try { this.ws.close(); } catch {} }
}

async function waitJson(url, tries = 60) { for (let i = 0; i < tries; i++) { try { const r = await fetch(url); if (r.ok) return await r.json(); } catch {} await sleep(300); } throw new Error("CDP not ready at " + url); }
async function newTab(url) { try { const r = await fetch(`http://localhost:${CDP_PORT}/json/new?${encodeURIComponent(url)}`, { method: "PUT" }); return await r.json(); } catch { const r = await fetch(`http://localhost:${CDP_PORT}/json/new?${encodeURIComponent(url)}`); return await r.json(); } }

try {
  await waitJson(`http://localhost:${CDP_PORT}/json/version`);
  const tab = await newTab(`${BASE}/?test=1`);
  const cdp = new CDP(tab.webSocketDebuggerUrl);
  await cdp.call("Page.enable");
  await cdp.call("Runtime.enable");
  await sleep(1500);

  const ready = await cdp.eval(`new Promise(r=>{const t=setInterval(()=>{if(window.__skbHarness){clearInterval(t);r(true);}},200);setTimeout(()=>r(false),15000);})`);
  if (!ready) throw new Error("harness not ready");

  // 建局 + 注入可用武器/杀 + 预选；牌堆顶随机，无攻击报价则重试 setup
  let cards = null;
  for (let attempt = 0; attempt < 4 && !cards?.hasAttack; attempt++) {
    cards = await cdp.eval(`(async()=>{const h=window.__skbHarness;await h.setup({charactersBySeat:{1:"character.knight",2:"character.ranger",3:"character.paladin",4:"character.wizard"}});const a=await h.getAuthoritative();const tops=a.drawPileTopTemplates||[];const wp=tops.find(t=>String(t).startsWith("weapon."));const k=tops.find(t=>String(t).startsWith("basic.kill."));if(wp&&k)await h.injectHand(1,[wp,k],"append");else if(k)await h.injectHand(1,[k],"append");await h.refreshState();let s=await h.getSnapshots();let d=Date.now()+8000;while(Date.now()<d&&!s[0]?.snapshot?.privateView)await new Promise(r=>setTimeout(r,200)),s=await h.getSnapshots();let snap=s[0]?.snapshot;const equip=snap?.interaction?.offers?.find(o=>String(o.offerId).includes("weapon-equip")&&String(o.offerId).includes("weapon:1:1"));if(equip){await h.execute(1,equip.offerId,{});await h.refreshState();s=await h.getSnapshots();snap=s[0]?.snapshot;}if(!snap?.privateView?.preselectedWeaponSlot){await h.preselect(1,"weapon:1:1",null);await h.refreshState();s=await h.getSnapshots();snap=s[0]?.snapshot;}return {wp,k,hasAttack:!!(snap?.interaction?.offers||[]).find(o=>String(o.offerId).includes("attack"))};})()`);
    if (!cards.hasAttack) await sleep(400);
  }
  if (!cards?.hasAttack) throw new Error("no attack offer after retries");
  console.log("cards:", JSON.stringify(cards));
  await cdp.shot("shot-0-idle.png");

  // 攻击 seat 2 → standby 荧光箭头（响应窗口）
  const attack = await cdp.eval(`(async()=>{const h=window.__skbHarness;const s=await h.getSnapshots();const snap=s[0].snapshot;const attack=snap.interaction.offers.find(o=>String(o.offerId).includes("attack"));const specs=attack.selectionSpecs;const kill=specs.find(x=>x.key==="killCards").legalRefs[0];const target=specs.find(x=>x.key==="targets").legalRefs.find(r=>r.endsWith("seat_2"))||specs.find(x=>x.key==="targets").legalRefs[0];await h.execute(1,attack.offerId,{killCards:[kill],targets:[target]});await new Promise(r=>setTimeout(r,500));return true;})()`);
  await cdp.shot("shot-1-attack-standby.png");

  // pass → 命中填充揭示（尾部→头部加速填色）
  await cdp.eval(`(async()=>{const h=window.__skbHarness;const s=await h.getSnapshots();const snap=s[1].snapshot;const pass=snap?.interaction?.offers?.find(o=>String(o.offerId).includes(":pass:"));if(pass){await h.execute(2,pass.offerId,{});}await new Promise(r=>setTimeout(r,120));return true;})()`);
  await cdp.shot("shot-2-hit-fill-revealing.png");
  await sleep(500);
  await cdp.shot("shot-3-hit-impact.png");

  // 药水自愈 → heal 色自指环闪光
  await cdp.eval(`(async()=>{const h=window.__skbHarness;await h.injectHand(1,["basic.potion.orange"],"append");await h.refreshState();let s=await h.getSnapshots();let snap=s[0].snapshot;let d=Date.now()+6000;while(Date.now()<d&&snap?.interaction?.prompt?.kind!=="playPhaseAction"){await new Promise(r=>setTimeout(r,200));await h.refreshState();s=await h.getSnapshots();snap=s[0].snapshot;}const potion=snap?.interaction?.offers?.find(o=>String(o.offerId).includes("potion"));if(potion){const targ=(potion.selectionSpecs||[]).find(x=>x.key==="targets");const sel={};if(targ?.legalRefs)sel.targets=[targ.legalRefs[0]];await h.execute(1,potion.offerId,sel);await new Promise(r=>setTimeout(r,150));}return !!potion;})()`);
  await cdp.shot("shot-4-heal-ring.png");
  await sleep(500);
  await cdp.shot("shot-5-heal-ring-after.png");

  cdp.close();
  console.log("done, shots in", OUT_DIR);
} catch (error) {
  console.error("FAILED:", error.message);
  process.exitCode = 1;
} finally {
  cleanup();
}
