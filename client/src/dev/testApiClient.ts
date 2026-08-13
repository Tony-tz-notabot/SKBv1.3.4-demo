import { resolveApiBase } from "../network/serverAddress";

// 服务端 testApi（SKB_TEST_MODE=1）的 fetch 封装，供测试驱动视图与 __skbHarness 使用。

export interface TestSetupOptions {
  hands?: Record<string, string[]>;
  charactersBySeat?: Record<string, string>;
  firstSeat?: number;
  seed?: number;
  skipRedraw?: boolean;
  displayNames?: Record<string, string>;
  responseTimeSeconds?: number;
  turnTimeSeconds?: number;
}
export interface TestPlayerInfo { seat: number; userId: string; displayName: string; token: string; characterId: string }
export interface TestSetupResult { ok: boolean; gameId: string; roomId: string; roomCode: string; firstSeat: number; lifecycle: string; stateRevision: number; players: TestPlayerInfo[] }
export interface TestWindowSummary { promptId: string; kind: string; prioritySeat: number; mandatory: boolean; deadlineAt: number; timeoutPolicy: string; legalOfferIds: string[]; context: Record<string, unknown> }
export interface TestPlayerSummary {
  seat: number; team: "A" | "B"; characterId: string; hp: number | null; maxHp: number | null; shield: number | null; maxShield: number | null;
  ironShield: number; lifeState: string; statuses: Array<{ statusId: string; stacks: number; durationId: string | null }>; markers: Record<string, unknown>; handTemplates: string[]; equipmentTemplates: string[];
}
export interface TestStateSummary {
  gameId: string; stateRevision: number; lastEventSeq: number; lifecycle: string; round: number; activeSeat: number | null; phase: string | null; phaseBoundary: string | null; winnerTeam: "A" | "B" | null;
  drawPileCount: number; drawPileTopTemplates: string[]; discardAllTemplates: string[]; resolvingTemplates: string[];
  pendingWindows: TestWindowSummary[]; resolutionStackCount: number; players: TestPlayerSummary[];
  recentEvents: Array<{ eventSeq: number; stateRevision: number; eventType: string; payload: unknown }>;
}

export class TestApiClient {
  constructor(private readonly base: string = resolveApiBase(import.meta.env.VITE_WS_URL)) {}

  async setup(options: TestSetupOptions = {}): Promise<TestSetupResult> {
    return this.post("/api/test/setup", options);
  }
  async hand(gameId: string, seat: number, templates: string[], mode: "replace" | "append" = "replace"): Promise<TestStateSummary> {
    return this.post("/api/test/hand", { gameId, seat, templates, mode });
  }
  async deck(gameId: string, templates: string[], mode: "top" | "bottom" = "top"): Promise<TestStateSummary> {
    return this.post("/api/test/deck", { gameId, templates, mode });
  }
  async state(gameId: string, closed = false): Promise<TestStateSummary> {
    const response = await fetch(`${this.base}/api/test/state?gameId=${encodeURIComponent(gameId)}${closed ? "&closed=1" : ""}`);
    const data = await response.json() as TestStateSummary & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "TEST_STATE_FAILED");
    return data;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "TEST_API_FAILED");
    return data;
  }
}
