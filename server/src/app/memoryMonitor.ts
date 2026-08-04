import { performance } from "node:perf_hooks";

export interface MemoryMonitorOptions {
  intervalMs?: number;
  warnThresholdMb?: number;
}

// 周期采样 process.memoryUsage() 并输出到 stdout，用于云服务器部署时观测内存水位。
// 数据字段：rss / heapUsed（进程实际占用与 V8 堆）均以 MB 计，Δ 为自上次采样差值。
export function startMemoryMonitor(options: MemoryMonitorOptions = {}): NodeJS.Timeout {
  const intervalMs = options.intervalMs ?? 10000;
  const warnThresholdMb = options.warnThresholdMb ?? 512;
  let last: { rssMb: number; heapMb: number; peakRssMb: number } | null = null;
  let peakRssMb = 0;
  return setInterval(() => {
    const { rss, heapUsed } = process.memoryUsage();
    const rssMb = rss / 1024 / 1024;
    const heapMb = heapUsed / 1024 / 1024;
    peakRssMb = Math.max(peakRssMb, rssMb);
    const rssDelta = last === null ? 0 : rssMb - last.rssMb;
    const heapDelta = last === null ? 0 : heapMb - last.heapMb;
    last = { rssMb, heapMb, peakRssMb };
    const ts = new Date().toISOString();
    const warnings = rssMb >= warnThresholdMb ? " ⚠ RSS 超过告警阈值" : "";
    console.log(`[memory] ${ts} rss=${rssMb.toFixed(1)}MB heap=${heapMb.toFixed(1)}MB Δrss=${rssDelta >= 0 ? "+" : ""}${rssDelta.toFixed(1)}MB Δheap=${heapDelta >= 0 ? "+" : ""}${heapDelta.toFixed(1)}MB peakRss=${peakRssMb.toFixed(1)}MB${warnings}`);
  }, intervalMs).unref();
}

// 仅供测试/诊断手动触发一次采样。
export function sampleMemoryNow(): { ts: string; rssMb: number; heapMb: number; uptimeSeconds: number } {
  const { rss, heapUsed } = process.memoryUsage();
  return {
    ts: new Date().toISOString(),
    rssMb: rss / 1024 / 1024,
    heapMb: heapUsed / 1024 / 1024,
    uptimeSeconds: Math.floor(performance.timeOrigin > 0 ? process.uptime() : 0)
  };
}
