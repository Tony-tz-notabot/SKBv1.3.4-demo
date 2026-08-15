// 操作指示箭头几何（132 §4.1 修订）：↑ 形战略行军图箭头——尖头 + 等宽柄（头部三角稍宽、
// 柄略收窄），直线侧边，白色描边轮廓；自指环为环形。
// 命中填充：fillClip 给出"尾部小三角 → 头部大三角"的 clipPath 多边形（用户空间坐标），
// 由 StageArrow 用 SMIL 动画按加速曲线从尾部向头部揭示（填色渲染并冲击）。
export interface Point {
  x: number;
  y: number;
}

export interface ArrowGeometry {
  /** SVG 填充路径（从尖头起：头尖→头左→尾左→尾右→头右→闭合） */
  path: string;
  headTip: Point;
  tailCenter: Point;
  /** 尾部宽度（柄宽） */
  width: number;
  ring: boolean;
  /** 填充揭示 clipPath 多边形 points（用户空间坐标字符串）：from=尾部小三角，to=头部大三角 */
  fillClip: { from: string; to: string };
  /** 环起点（自指环专用） */
  tailStart?: Point;
}

export interface ArrowPathOptions {
  /** 整体宽度（头部宽） */
  width?: number;
  /** 头部占轴向长度比例 */
  headRatio?: number;
  /** 整体法线方向偏移（多目标扇形分离） */
  bend?: number;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const r = (v: number) => Math.round(v * 100) / 100;
const pt = (p: Point) => `${r(p.x)},${r(p.y)}`;

/** ↑ 楔形箭头：尖头（to）→ 头部三角（头宽 headW）→ 柄（尾宽 tailW，从 headBase 到 from）。 */
export function buildArrowPath(from: Point, to: Point, opts: ArrowPathOptions = {}): ArrowGeometry {
  const headW = opts.width ?? 30;
  const headRatio = clamp(opts.headRatio ?? 0.4, 0.25, 0.6);
  const bend = clamp(opts.bend ?? 0, -80, 80);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const tailW = headW * 0.78;
  const headBaseX = from.x + len * headRatio * ux + bend * nx;
  const headBaseY = from.y + len * headRatio * uy + bend * ny;
  const t1x = from.x + (tailW / 2) * nx + bend * nx;
  const t1y = from.y + (tailW / 2) * ny + bend * ny;
  const t2x = from.x - (tailW / 2) * nx + bend * nx;
  const t2y = from.y - (tailW / 2) * ny + bend * ny;
  const p1x = headBaseX + (headW / 2) * nx;
  const p1y = headBaseY + (headW / 2) * ny;
  const p2x = headBaseX - (headW / 2) * nx;
  const p2y = headBaseY - (headW / 2) * ny;
  const hx = to.x + bend * nx;
  const hy = to.y + bend * ny;

  const path =
    `M ${r(hx)} ${r(hy)} L ${r(p1x)} ${r(p1y)} L ${r(t1x)} ${r(t1y)} L ${r(t2x)} ${r(t2y)} L ${r(p2x)} ${r(p2y)} Z`;

  // 填充揭示三角形：顶点1（尖端）从尾部（from 稍前）移到头部（to），顶点2/3 为尾左右（不变）。
  const tipFrom = { x: from.x + len * 0.12 * ux + bend * nx, y: from.y + len * 0.12 * uy + bend * ny };
  const fillClip = {
    from: `${pt(tipFrom)} ${pt({ x: t1x, y: t1y })} ${pt({ x: t2x, y: t2y })}`,
    to: `${pt({ x: hx, y: hy })} ${pt({ x: t1x, y: t1y })} ${pt({ x: t2x, y: t2y })}`,
  };

  return { path, headTip: { x: hx, y: hy }, tailCenter: from, width: tailW, ring: false, fillClip };
}

/** 自指环：起点=终点，箭头绕成一圈，头部开口贴近起点。 */
export function buildRingPath(center: Point, radius: number, opts: ArrowPathOptions = {}): ArrowGeometry {
  const width = opts.width ?? 18;
  const sweepDeg = 340; // 环弧覆盖角度，留 20° 开口
  const r0 = -Math.PI / 2;
  const r1 = r0 + (sweepDeg * Math.PI) / 180;
  const tip = { x: center.x + radius * Math.cos(r1), y: center.y + radius * Math.sin(r1) };
  const tx = -Math.sin(r1);
  const ty = Math.cos(r1);
  const headW = width * 0.9;
  const b1 = { x: tip.x - tx * (headW / 2), y: tip.y - ty * (headW / 2) };
  const b2 = { x: tip.x + tx * (headW / 2), y: tip.y + ty * (headW / 2) };
  const tailP = { x: center.x + radius * Math.cos(r0), y: center.y + radius * Math.sin(r0) };
  const t0x = -Math.sin(r0);
  const t0y = Math.cos(r0);
  const notch = { x: tailP.x - t0x * width * 0.3, y: tailP.y - t0y * width * 0.3 };
  const largeArc = sweepDeg >= 180 ? 1 : 0;
  const path =
    `M ${r(tip.x)} ${r(tip.y)} L ${r(b1.x)} ${r(b1.y)} A ${r(radius)} ${r(radius)} 0 ${largeArc} 1 ${r(tailP.x)} ${r(tailP.y)} ` +
    `L ${r(notch.x)} ${r(notch.y)} L ${r(b2.x)} ${r(b2.y)} Z`;
  const fillClip = {
    from: `${pt({ x: tailP.x, y: tailP.y })} ${pt({ x: b1.x, y: b1.y })} ${pt({ x: b2.x, y: b2.y })}`,
    to: `${pt(tip)} ${pt({ x: b1.x, y: b1.y })} ${pt({ x: b2.x, y: b2.y })}`,
  };
  return { path, headTip: tip, tailCenter: center, width, ring: true, fillClip, tailStart: tailP };
}
