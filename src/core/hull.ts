// 参数化船型几何：主尺度 + 型线参数 -> 站线/半宽/型值表
import type { HullParams } from './types';

export interface HullStation {
  x: number;          // 站线纵向位置（米，船中=0，艏正艉负）
  halfBreadths: number[]; // 各水线半宽（米）
  depths: number[];      // 对应水线深度（米，自水线向下）
  area: number;          // 横剖面面积（米²）
}

export interface HullGeometry {
  params: HullParams;
  stations: HullStation[];
  waterlineZs: number[];      // 水线深度数组
  deckHalfBreadth: number[];  // 每站甲板半宽
  /** 三维网格（用于 WebGPU 渲染）：顶点 (x,y,z)，y 向上 */
  mesh: {
    positions: Float32Array;
    indices: Uint32Array;
    nx: number;
    nz: number;
  };
  /** 排水体积（米³，数值积分） */
  displacedVolume: number;
}

const N_STATIONS = 21;   // 0=艉 … 20=艏
const N_WATERLINES = 10;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 纵向面积曲线（横剖面面积沿船长分布）。
 * 用两段余弦 + 棱形系数控制，归一化 s∈[0,1]（艉→艏）。
 */
function sectionAreaCurve(s: number, cb: number, prismaticBias: number): number {
  // 基础形状：1 - (2s-1)^2 的幂次，幂越高越饱满（中体越长）
  const base = Math.pow(Math.max(0, 1 - Math.pow(2 * s - 1, 2)), 0.5 + (0.75 - cb) * 1.5);
  // 艏艉不对称：prismaticBias>0 偏 U 形（丰满），<0 偏 V 形（瘦削）
  const skew = 1 + prismaticBias * 0.25 * (2 * s - 1);
  return clamp(base * skew, 0, 1.2);
}

/**
 * 单站横剖面半宽（Lewis 型变换的工程近似）。
 * t: 水线相对深度 0(水线)→1(龙骨)
 */
function sectionHalfBreadth(
  t: number,
  maxHalfBreadth: number,
  cm: number,
  bias: number,
  transomFlare: number,
): number {
  // V 形偏尖底，U 形偏平底；bias∈[-1,1]
  const u = bias * 0.5;
  // 剖面轮廓：(1-t^p)^(1/q) 族
  const p = 2.2 - u * 0.8;          // V→U
  const q = 2.0 + u * 0.6;
  let shape = Math.pow(Math.max(0, 1 - Math.pow(t, p)), 1 / q);
  // 中横剖面系数修正：Cm 小则剖面内凹
  const hollow = (0.98 - cm) * 1.6 * Math.sin(Math.PI * t) * (0.3 + 0.7 * t);
  shape = clamp(shape - hollow, 0, 1);
  // 方艉/外飘（仅近水线处）
  shape *= 1 + transomFlare * 0.12 * Math.exp(-t * 4);
  return maxHalfBreadth * shape;
}

export function generateHull(params: HullParams): HullGeometry {
  const {
    lengthBP: L,
    beam: B,
    draft: T,
    blockCoeff: cb,
    midshipCoeff: cm,
    entranceAngle,
    prismaticCurve: bias,
    bulb,
    transom,
  } = params;

  const waterlineZs: number[] = [];
  for (let j = 0; j <= N_WATERLINES; j++) waterlineZs.push((j / N_WATERLINES) * T);

  // 面积曲线按目标排水体积 ∇ = Cb·L·B·T 直接标定，保证实际 Cb 精确
  const rawAreas: number[] = [];
  let rawIntegral = 0;
  for (let i = 0; i < N_STATIONS; i++) {
    const s = i / (N_STATIONS - 1);
    const a = sectionAreaCurve(s, cb, bias);
    rawAreas.push(a);
    rawIntegral += a;
  }
  rawIntegral /= N_STATIONS - 1;
  const targetVolume = cb * L * B * T;
  const norm = targetVolume / (rawIntegral * L);

  const stations: HullStation[] = [];
  const deckHalfBreadth: number[] = [];

  for (let i = 0; i < N_STATIONS; i++) {
    const s = i / (N_STATIONS - 1);
    const x = (s - 0.5) * L;
    const area = rawAreas[i] * norm;
    // 中横剖面系数约束：中站面积 ≈ Cm·B·T，由本站最大半宽反推
    const kappa = 0.62 + cm * 0.35 + bias * 0.03;
    let hb = area / (2 * T * kappa);
    hb = clamp(hb, 0, B / 2);

    // 进流角影响：艏部收窄更急
    const entrance = (entranceAngle / 30) * 0.25 * Math.pow(s, 3);
    hb *= 1 - entrance;

    const halfBreadths: number[] = [];
    const depths: number[] = [];
    for (let j = 0; j <= N_WATERLINES; j++) {
      const t = j / N_WATERLINES;
      depths.push(waterlineZs[j]);
      let y = sectionHalfBreadth(t, hb, cm, bias, transom * (1 - s));
      // 球鼻艏：最艏站近龙骨处局部鼓出
      if (s > 0.85 && t > 0.55) {
        const bow = Math.pow((s - 0.85) / 0.15, 2) * Math.exp(-Math.pow((t - 0.8) * 4, 2));
        y += bulb * 0.18 * B * bow;
      }
      halfBreadths.push(y);
    }
    deckHalfBreadth.push(halfBreadths[0]);
    stations.push({ x, halfBreadths, depths, area });
  }
  // 艏端、艉端封死
  stations[0].halfBreadths.fill(0);
  stations[N_STATIONS - 1].halfBreadths.fill(0);

  // 排水体积积分（梯形法）
  let displacedVolume = 0;
  for (let i = 1; i < N_STATIONS; i++) {
    displacedVolume += 0.5 * (stations[i].area + stations[i - 1].area) * (L / (N_STATIONS - 1));
  }

  const mesh = buildHullMesh(stations, T, transom);
  return { params, stations, waterlineZs: waterlineZs, deckHalfBreadth, mesh, displacedVolume };
}

/** 左右舷 + 甲板面的三角网格，y 向上、水线 y=0、龙骨 y=-T */
function buildHullMesh(stations: HullStation[], T: number, _transom: number) {
  const nx = stations.length;
  const nz = stations[0].halfBreadths.length;
  const positions: number[] = [];
  const indices: number[] = [];

  const pushSide = (side: 1 | -1) => {
    const base = positions.length / 3;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const st = stations[i];
        positions.push(st.x, -st.depths[j], side * st.halfBreadths[j]);
      }
    }
    for (let i = 0; i < nx - 1; i++) {
      for (let j = 0; j < nz - 1; j++) {
        const a = base + i * nz + j;
        const b = a + nz;
        if (side === 1) {
          indices.push(a, b, a + 1, b, b + 1, a + 1);
        } else {
          indices.push(a, a + 1, b, b, a + 1, b + 1);
        }
      }
    }
  };
  pushSide(1);
  pushSide(-1);

  // 甲板（水线面处左右舷相连）
  const deckBase = positions.length / 3;
  for (let i = 0; i < nx; i++) {
    const st = stations[i];
    positions.push(st.x, 0, st.halfBreadths[0]);
    positions.push(st.x, 0, -st.halfBreadths[0]);
  }
  for (let i = 0; i < nx - 1; i++) {
    const a = deckBase + i * 2;
    indices.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    nx,
    nz,
  };
}

/** 默认 Wigley 型瘦削船（便于与经典理论对比） */
export function defaultHullParams(id: string): HullParams {
  return {
    id,
    name: 'Wigley 标准瘦船型',
    updatedAt: Date.now(),
    lengthBP: 48,
    beam: 6,
    draft: 3,
    blockCoeff: 0.52,
    midshipCoeff: 0.9,
    entranceAngle: 12,
    prismaticCurve: -0.2,
    bulb: 0.2,
    transom: 0.15,
  };
}

export function hullSummary(g: HullGeometry) {
  const p = g.params;
  const cbActual = g.displacedVolume / (p.lengthBP * p.beam * p.draft);
  return { displacedVolume: g.displacedVolume, cbActual };
}
