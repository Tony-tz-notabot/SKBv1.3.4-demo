// 离线包模式：API 地址从 VITE_WS_URL 推导（ws→http，取同源）
export function resolveApiBase(wsBase: string | undefined): string {
  if (!wsBase) return "";
  try {
    const url = new URL(wsBase);
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}
