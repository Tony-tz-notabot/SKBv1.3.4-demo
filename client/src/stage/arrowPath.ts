// 操作指示箭头几何（132 §4.1）：作战地图风宽箭头——整体宽、尾巴宽且中间自然凹陷（∨）、
// 主体左右两侧为外凸弧线（C 曲线）、箭头大；自指环为环形（A 圆弧 + 开口贴近起点）。
export interface Point {
  x: number;
  y: number;
}

export interface ArrowGeometry {
  /** SVG 填充路径（从头尖起，顺时针：左头边→左弧侧→左尾→尾凹→右尾→右弧侧→右头边→闭合） */
  path: string;
  headTip: Point;
  /** 头部基座 x（水平箭头时用于校验头长比例） */
  headBaseX: number;
  tailCenter: Point;
  /** 尾凹点（比尾中心更靠后） */
  notch: Point;
  /** 环起点（自指环专用） */
  tailStart?: Point;
  /** 尾部宽度 */
  width: number;
  /** 侧弧弯曲横向偏移（多目标扇形用） */
  bendExtent: number;
  ring: boolean;
}

export interface ArrowPathOptions {
  /** 整体宽度 */
  width?: number;
  /** 头部占总长比例 */
  headRatio?: number;
  /** 尾凹深度（相对宽度） */
  tailNotch?: number;
  /** 侧弧外凸幅度（相对宽度） */
  bulge?: number;
  /** 整体横向弯曲（法线方向偏移，多目标扇形分离） */
  bend?: number;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function buildArrowPath(from: Point, to: Point, opts: ArrowPathOptions = {}): ArrowGeometry {
  const width = opts.width ?? 26;
  const headRatio = clamp(opts.headRatio ?? 0.32, 0.2, 0.5);
  const tailNotch = opts.tailNotch ?? 0.3;
  const bulge = opts.bulge ?? 0.55;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const headLen = len * headRatio;
  const headW = width * 0.92;
  const tailW = width * 0.8;
  const notchDepth = width * tailNotch;

  const hx = to.x;
  const hy = to.y;
  const b1x = hx - headLen * ux - (headW / 2) * nx;
  const b1y = hy - headLen * uy - (headW / 2) * ny;
  const b2x = hx - headLen * ux + (headW / 2) * nx;
  const b2y = hy - headLen * uy + (headW / 2) * ny;
  const t1x = from.x - (tailW / 2) * nx;
  const t1y = from.y - (tailW / 2) * ny;
  const t2x = from.x + (tailW / 2) * nx;
  const t2y = from.y + (tailW / 2) * ny;
  const notx = from.x - notchDepth * ux;
  const noty = from.y - notchDepth * uy;

  const mid1x = (t1x + b1x) / 2;
  const mid1y = (t1y + b1y) / 2;
  const mid2x = (t2x + b2x) / 2;
  const mid2y = (t2y + b2y) / 2;
  const bulg = bulge * width * 0.5;
  const bend = clamp(opts.bend ?? 0, -80, 80);

  const path =
    `M ${r(hx)} ${r(hy)} L ${r(b1x)} ${r(b1y)} C ${r(mid1x - bulg * nx + bend * nx)} ${r(mid1y - bulg * ny + bend * ny)} ${r(mid1x - bulg * nx + bend * nx)} ${r(mid1y - bulg * ny + bend * ny)} ${r(t1x)} ${r(t1y)} ` +
    `L ${r(notx)} ${r(noty)} L ${r(t2x)} ${r(t2y)} C ${r(mid2x + bulg * nx + bend * nx)} ${r(mid2y + bulg * ny + bend * ny)} ${r(mid2x + bulg * nx + bend * nx)} ${r(mid2y + bulg * ny + bend * ny)} ${r(b2x)} ${r(b2y)} Z`;

  return { path, headTip: { x: hx, y: hy }, headBaseX: b1x, tailCenter: { x: from.x, y: from.y }, notch: { x: notx, y: noty }, width: tailW, bendExtent: bend, ring: false };
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
  return { path, headTip: tip, headBaseX: b1.x, tailCenter: center, notch, tailStart: tailP, width, bendExtent: 0, ring: true };
}

const r = (v: number) => Math.round(v * 100) / 100;
