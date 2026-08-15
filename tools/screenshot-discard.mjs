// screenshot-discard.mjs — Edge headless + CDP：setup → 塞牌超上限 → finish 出牌 → 弃牌阶段弃牌 → 截弃牌堆正面图。
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CDP_PORT = 9224;
const BASE = "http://localhost:8787";
const OUT_DIR = resolve(process.cwd(), "server", "data", "shots");
mkdirSync(OUT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = resolve(process.cwd(), "server", "data", "shots-edge-discard");
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

  const setup = await cdp.eval(`(async()=>{const h=window.__skbHarness;await h.setup({charactersBySeat:{1:"character.knight",2:"character.ranger",3:"character.paladin",4:"character.wizard"}});await h.refreshState();await new Promise(r=>setTimeout(r,500));const tops=(await h.getAuthoritative()).drawPileTopTemplates||[];const extra=tops.slice(0,6);await h.injectHand(1,extra,"append");await h.refreshState();await new Promise(r=>setTimeout(r,500));let s=await h.getSnapshots();let snap=s[0]?.snapshot;const fin=snap?.interaction?.offers?.find(o=>String(o.offerId).includes("playPhaseAction:finish"));let finRes=null;if(fin){finRes=await h.execute(1,fin.offerId,{});}await h.refreshState();await new Promise(r=>setTimeout(r,600));s=await h.getSnapshots();snap=s[0]?.snapshot;const sub=snap?.interaction?.offers?.find(o=>String(o.offerId).includes("discardPhaseAction:submit"));const cards=sub?.selectionSpecs?.find(x=>x.key==="cards");const picks=cards?.legalRefs?.slice(0,Math.max(1,cards?.min||1))||[];let subRes=null;if(sub)subRes=await h.execute(1,sub.offerId,{cards:picks});await h.refreshState();await new Promise(r=>setTimeout(r,900));return {handBefore:snap?.privateView?.hand?.length,phase:snap?.publicView?.phase,hadFin:!!fin,finRes:String(finRes),hadSub:!!sub,subRes:String(subRes),picks:picks.length,extra:extra.slice(0,3)};})()`);
  console.log("setup:", JSON.stringify(setup));
  await cdp.shot("shot-discard-0-idle.png");
  const info = await cdp.eval(`(()=>{const d=document.querySelectorAll('.stage-discard .stage-card');const imgs=[...d].map(c=>{const i=c.querySelector('img');return i?(i.getAttribute('src')||'').slice(0,26):null});return JSON.stringify({discardCards:d.length,discardImgs:imgs,narration:document.querySelector('.stage-narration')?.textContent.trim()});})()`);
  console.log("discard:", info);
  await cdp.shot("shot-discard-1.png");
  cdp.close();
  console.log("done, shots in", OUT_DIR);
} catch (error) {
  console.error("FAILED:", error.message);
  process.exitCode = 1;
} finally {
  cleanup();
}
