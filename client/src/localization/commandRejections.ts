export type RejectionLike = { reasonCode: string; messageKey: string; refreshRequired: boolean };

const reasonMessages: Record<string, string> = {
  STALE_REVISION: "房间状态已经变化，本次操作未执行。",
  PROMPT_CLOSED: "操作窗口已经关闭。",
  OFFER_EXPIRED: "该操作选项已经失效。",
  NOT_YOUR_PRIORITY: "现在还没轮到你操作。",
  SELECTION_COUNT_INVALID: "选择的数量不符合要求。",
  TARGET_NO_LONGER_LEGAL: "所选目标已经不再合法。",
  COST_UNPAYABLE: "当前无法支付这项操作的费用。",
  OBJECT_NOT_VISIBLE: "你目前无法查看或操作该对象。",
  ROOM_NOT_FOUND: "没有找到这个房间，请检查房间号。",
  ROOM_FULL: "房间座位已满。",
  ROOM_CLOSED: "该房间已经关闭。",
  WRONG_PASSWORD: "房间密码不正确。",
  SPECTATING_DISABLED: "该房间不允许观战。",
  GUESTS_DISABLED: "该房间不允许游客加入。",
  VERSION_MISMATCH: "客户端与房间的规则版本不一致。",
  PERMISSION_DENIED: "你没有执行这项操作的权限。",
  ALREADY_IN_ROOM: "你已经在一个房间中。",
  NAME_INVALID: "房间名称不符合要求。",
  RATE_LIMITED: "操作过于频繁，请稍后再试。",
};

const keyMessages: Record<string, string> = {
  "room.error.notFound": "没有找到这个房间，请检查房间号。",
  "room.error.full": "房间座位已满。",
  "room.error.wrongPassword": "房间密码不正确。",
  "room.error.spectatingDisabled": "该房间不允许观战。",
  "room.error.staleRevision": "房间状态已经变化，本次操作未执行。",
  "command.error.permissionDenied": "你没有执行这项操作的权限。",
};

export function localizeCommandRejection(rejection: RejectionLike): { title: string; detail: string } {
  const detail = keyMessages[rejection.messageKey]
    ?? reasonMessages[rejection.reasonCode]
    ?? "服务器未接受这次操作，请稍后重试。";
  return {
    title: "操作未完成",
    detail: rejection.refreshRequired ? `${detail} 正在同步最新状态，请同步完成后重试。` : detail,
  };
}
