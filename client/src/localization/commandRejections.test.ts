import { describe, expect, it } from "vitest";
import { localizeCommandRejection } from "./commandRejections";

describe("localizeCommandRejection", () => {
  it("优先使用已登记的消息键", () => {
    expect(localizeCommandRejection({ reasonCode: "UNKNOWN", messageKey: "room.error.full", refreshRequired: false }).detail).toBe("房间座位已满。");
  });
  it("对未知拒绝安全降级且不直接暴露内部键", () => {
    expect(localizeCommandRejection({ reasonCode: "X", messageKey: "internal.x", refreshRequired: false }).detail).toBe("服务器未接受这次操作，请稍后重试。");
  });
  it("需要刷新时追加同步提示", () => {
    expect(localizeCommandRejection({ reasonCode: "STALE_REVISION", messageKey: "", refreshRequired: true }).detail).toContain("正在同步最新状态");
  });
});
