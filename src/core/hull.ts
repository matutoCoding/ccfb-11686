// 船型参数化几何: 由主尺度与型线系数生成横剖面/水线/型值
import type { HullSpec } from './types.ts';

export interface HullStation {
  /** 站号 x/Lpp, -0.5(艉) .. 0.5(艏) */
  xs: number;
  /** 半宽水线 b(t), t=z/T 0(基线)..1(设计水线) */
  halfBreadth: (t: number) => number;
  /** 设计水线处半宽 */
  bwl: number;
  /** 横剖面面积(单侧, m^2) */
  area: number;
}

/** 纵向面积/水线分布曲线( Lackenby 风格的多项式权重) */
function longitudinalShape(xs: number, lcb: number, fullness: number): number {
  // xs: -0.5..0.5; 艏部更饱满, LCB 微调峰值位置
  const u = xs + 0.5; // 0..1 艉→艏
  const peak = 0.5 + lcb;
  const base = Math.pow(Math.sin(Math.PI * u), 0.6 + (1 - fullness) * 0.8);
  const skew = 1 + 0.35 * (u - peak);
  return Math.max(0, base * skew);
}

export function maxSectionArea(hull: HullSpec): number {
  // 由 Cb 反推: 排水体积 ∇=Cb LBT, 中横剖面面积 Am=Cm BT
  return hull.Cm * hull.B * hull.T;
}

/** 生成 21 站横剖面 */
export function buildStations(hull: HullSpec, nStations = 21): HullStation[] {
  const Am = maxSectionArea(hull);
  const out: HullStation[] = [];
  const raw: { xs: number; w: number }[] = [];
  let wSum = 0;
  for (let i = 0; i < nStations; i++) {
    const xs = -0.5 + i / (nStations - 1);
    const w = longitudinalShape(xs, hull.LCB / 100, hull.Cb);
    raw.push({ xs, w });
    wSum += w;
  }
  // 归一化使积分面积满足 Cb
  for (const { xs, w } of raw) {
    const sectionArea = (Am * w * nStations) / (wSum * 1) / 1;
    const area = Am * (w / wSum) * (nStations / (nStations - 1));
    void sectionArea;
    // 该站设计水线半宽: 由水线面系数分配
    const bwl =
      (hull.B / 2) *
      Math.pow(w / wSum, 0.5) *
      Math.sqrt((hull.Cwp * 2 * nStations) / (nStations - 1)) *
      0.98;
    // 横剖面半宽函数: U/V 型由 sectionShape 调节
    const shape = hull.sectionShape; // 0=V, 1=U
    const halfBreadth = (t: number): number => {
      const tt = Math.min(1, Math.max(0, t));
      const vShape = Math.pow(tt, 0.7 + shape * 0.9);
      const flare = 1 + 0.06 * (1 - tt) * (xs > 0.3 ? 1 : 0); // 艏部外飘
      return Math.min(hull.B / 2, bwl * vShape * flare);
    };
    // 数值积分横剖面面积 ∫ b dz
    let a = 0;
    const nz = 20;
    for (let iz = 0; iz < nz; iz++) {
      a += halfBreadth((iz + 0.5) / nz) * (hull.T / nz);
    }
    out.push({ xs, halfBreadth, bwl: Math.min(hull.B / 2, bwl), area: a });
  }
  // 方艉: 艉端宽度
  if (hull.transom > 0) {
    const st = out[0];
    const target = (hull.B / 2) * hull.transom;
    st.halfBreadth = (t) => Math.max(st.halfBreadth(t), target * Math.pow(t, 0.8));
    st.bwl = Math.max(st.bwl, target);
  }
  return out;
}

/** 校验排水体积对应的方型系数(与目标 Cb 的偏差) */
export function achievedBlockCoefficient(hull: HullSpec): number {
  const stations = buildStations(hull);
  let vol = 0;
  const dx = hull.Lpp / (stations.length - 1);
  for (const s of stations) vol += 2 * s.area * dx; // 双侧
  return vol / (hull.Lpp * hull.B * hull.T);
}

/** 设计水线半宽序列(俯视图用) */
export function waterlineOutline(hull: HullSpec): { x: number; y: number }[] {
  const st = buildStations(hull);
  const star = st.map((s) => ({ x: s.xs * hull.Lpp, y: s.bwl }));
  const port = [...star].reverse().map((p) => ({ x: p.x, y: -p.y }));
  return [...star, ...port];
}

/** 侧视轮廓(甲板线/基线/艏柱) */
export function sideProfile(hull: HullSpec): { x: number; z: number }[] {
  const L = hull.Lpp;
  return [
    { x: -L / 2, z: 0 },
    { x: L / 2, z: 0 },
    { x: L / 2, z: hull.T * 1.6 },
    { x: L * 0.42, z: hull.T * 1.7 },
    { x: -L / 2, z: hull.T * 1.5 },
  ];
}

/**
 * 船体等效移动压力源参数(供水面仿真)。
 * 压力源尺度取水线面特征长度; 为满足 Froude 相似,
 * 调用方可按 (V/Vref)^2 进一步缩放。
 */
export function pressureSourceParams(hull: HullSpec): {
  sourceScale: number;
  pressureAmp: number;
} {
  return {
    sourceScale: hull.Lpp * (0.12 + 0.1 * hull.Cb),
    pressureAmp: 0.08 + 0.12 * hull.Cb * hull.T,
  };
}

/**
 * 给定航速下满足 Froude 相似的压力源尺度。
 * 以参考航速 2 m/s、基准尺度 baseScale 为锚, 按 (V/2)^2 缩放。
 */
export function froudeSimilarSourceScale(speedMps: number, baseScale: number): number {
  const r = speedMps / 2;
  return baseScale * r * r;
}
