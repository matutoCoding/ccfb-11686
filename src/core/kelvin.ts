// 开尔文船行波: 匀速移动高斯压力源的线性势流谱积分
// 随船坐标系: x 指向艏(+), y 左舷为正, 船位于原点, 尾迹在 x<0。
// 深水 cusp 半角 asin(1/3)=19.471°; 有限水深由色散关系自动体现。
import { GRAVITY } from './types.ts';
import { groupRatio, wavenumberAt } from './physics.ts';

export interface KelvinParams {
  speedMps: number;
  /** 水深; Infinity 表示深水 */
  depth: number;
  /** 压力源强度 p0/rho [m^2/s^2] */
  pressureAmp: number;
  /** 压力源高斯尺度 [m] */
  sourceScale: number;
  /** 每个方向的谱分量数(波向 x 波数) */
  components: number;
  /** 近场伯努利波面占比 0..1 */
  nearFieldRatio?: number;
}

export interface KelvinComponent {
  /** 波向角 rad(与 -x 尾流轴夹角) */
  beta: number;
  k: number;
  kx: number;
  ky: number;
  /** 无量纲权重(已含源谱与雅可比) */
  weight: number;
}

/**
 * 稳态色散匹配: V kx = omega(k)
 * 深水 k = g cos(beta)/V^2; 有限水深二分求解, 越界返回 NaN。
 */
export function componentWavenumber(beta: number, speedMps: number, depth: number): number {
  const cb = Math.cos(beta);
  if (!Number.isFinite(depth) || depth <= 0) {
    return (GRAVITY * cb) / (speedMps * speedMps);
  }
  const fh2 = (speedMps * speedMps) / (GRAVITY * depth);
  // 有根条件: (V cos beta)^2 < g h  =>  Fh^2 cos^2(beta) < 1
  if (fh2 * cb * cb >= 1) return NaN;
  return wavenumberAt(speedMps * cb, depth);
}

/**
 * 驻相几何(参考/理论曲线用):
 *   tan(theta) = n tan(beta) / (1 - n + tan^2(beta)), n = cg/c
 */
export function rayTangent(beta: number, k: number, depth: number): number {
  const q = Number.isFinite(depth) && depth > 0 ? k * depth : Infinity;
  const n = !Number.isFinite(q) || q > 40 ? 0.5 : groupRatio(k, depth);
  const t = Math.tan(beta);
  return (n * t) / (1 - n + t * t);
}

/**
 * 理论 cusp 半角(度): 扫描 theta(beta) 的内部极大。
 * 深水 19.471°; 随 Fh 增大而张开, Fh→1 时趋于 90°。
 */
export function cuspAngleDeg(fh: number): number {
  if (!(fh > 0.05)) return 19.471220634;
  const depth = 1;
  const v = fh * Math.sqrt(GRAVITY * depth);
  // beta 下限避开小角度近场伪支(该处 psi'' 趋零但无远场能量)
  const betaMin = 0.25;
  const betaMax = fh < 1 ? 1.4 : Math.acos(1 / fh) * 0.999;
  const n = 8000;
  let maxTheta = 0;
  for (let i = 0; i < n; i++) {
    const beta = betaMin + ((betaMax - betaMin) * i) / n;
    const k = componentWavenumber(beta, v, depth);
    if (!Number.isFinite(k)) continue;
    const theta = Math.atan(rayTangent(beta, k, depth));
    if (theta > maxTheta) maxTheta = theta;
  }
  return (maxTheta * 180) / Math.PI;
}

/**
 * 构建离散谱: beta 在 [0, betaMax) 均匀取样, 每个 beta 由稳态条件定 k。
 * 高斯压力源 P(k)=p0 a^2 exp(-(ka)^2/2) 作为谱包络。
 */
export function buildSpectrum(p: KelvinParams): KelvinComponent[] {
  const { speedMps, depth, pressureAmp, sourceScale, components } = p;
  const v2 = speedMps * speedMps;
  const fh2 = Number.isFinite(depth) ? v2 / (GRAVITY * depth) : 0;
  // 超临界(Fh>1)时有效波向角 beta > arccos(1/Fh); 亚临界全角度有效
  const betaMin =
    Number.isFinite(depth) && fh2 > 1
      ? Math.acos(1 / Math.sqrt(fh2)) + 0.005
      : 0;
  const betaMax =
    Number.isFinite(depth) && fh2 > 1 ? Math.PI / 2 - 0.02 : Math.PI / 2 - 0.02;
  const span = betaMax - betaMin;
  const comps: KelvinComponent[] = [];
  for (let i = 0; i < components; i++) {
    const beta = betaMin + ((i + 0.5) / components) * span;
    const k = componentWavenumber(beta, speedMps, depth);
    if (!Number.isFinite(k)) continue;
    const cb = Math.cos(beta);
    const sb = Math.sin(beta);
    const ka = k * sourceScale;
    // 波面谱: z_k ~ (k P(k))/(V^2) ; 离散积分权重 dbeta
    const weight =
      ((pressureAmp * k * sourceScale * sourceScale * Math.exp(-0.5 * ka * ka)) / v2) *
      (span / components);
    comps.push({ beta, k, kx: k * cb, ky: k * sb, weight });
  }
  return comps;
}

/**
 * 单点波面升高。相位 phi = kx*(-x) ± ky*y(两舷对称),
 * 1/sqrt(k) 来自深水格林函数的频域振幅, 使量纲与远场行为正确。
 */
export function sampleHeight(
  x: number,
  y: number,
  comps: KelvinComponent[],
  p: KelvinParams,
): number {
  const astern = Math.max(0, -x);
  let z = 0;
  const nf = p.nearFieldRatio ?? 0;
  if (nf > 0) {
    const r2 = x * x + y * y;
    const a = p.sourceScale * 1.2;
    z -=
      nf * (p.pressureAmp / (p.speedMps * p.speedMps)) *
      Math.exp(-r2 / (2 * a * a));
  }
  if (astern < 1e-6) return z;
  for (let i = 0; i < comps.length; i++) {
    const c = comps[i];
    const phase = c.kx * astern;
    const lateral = c.ky * y;
    const amp = c.weight / Math.sqrt(c.k);
    z += amp * (Math.cos(phase + lateral) + Math.cos(phase - lateral));
  }
  return z;
}

/** 批量采样剖面 */
export function sampleProfile(
  yOffset: number,
  xFrom: number,
  xTo: number,
  n: number,
  comps: KelvinComponent[],
  p: KelvinParams,
): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = new Array(n);
  const dx = (xTo - xFrom) / (n - 1);
  for (let i = 0; i < n; i++) {
    const x = xFrom + i * dx;
    out[i] = { x, z: sampleHeight(x, yOffset, comps, p) };
  }
  return out;
}

/**
 * 尾迹半角测量(远场射线窄带能量法)。
 * 在船后 X 截面上, 对每个角度 bin 在射线 y=X tan(theta) 附近取
 * 若干采样点的最大 z²(消除干涉零点), 能量主峰即 cusp 射线方向。
 * 多个 X 截面取主峰角中位数, 提高稳健性。
 */
export function measureWakeAngle(
  comps: KelvinComponent[],
  p: KelvinParams,
  opts: {
    xList?: number[];
    angleMaxDeg?: number;
    angleBins?: number;
    probeHalfWidth?: number;
    probeStep?: number;
  } = {},
): { angleDeg: number; energy: { thetaDeg: number; e: number }[] } {
  const xList = opts.xList ?? [40, 50, 60];
  const angleMaxDeg = opts.angleMaxDeg ?? 60;
  const angleBins = opts.angleBins ?? 240;
  const probeHalfWidth = opts.probeHalfWidth ?? 5;
  const probeStep = opts.probeStep ?? 0.12;
  const acc = new Array<number>(angleBins).fill(0);
  const peakAngles: number[] = [];
  for (const X of xList) {
    const bins = new Array<number>(angleBins).fill(0);
    for (let b = 0; b < angleBins; b++) {
      const theta = ((b + 0.5) / angleBins) * (angleMaxDeg * Math.PI) / 180;
      const yc = X * Math.tan(theta);
      let m = 0;
      for (let j = -probeHalfWidth; j <= probeHalfWidth; j++) {
        const z = sampleHeight(-X, yc + j * probeStep, comps, p);
        const e = z * z;
        if (e > m) m = e;
      }
      bins[b] = m;
      acc[b] += m;
    }
    const pi = bins.indexOf(Math.max(...bins));
    peakAngles.push(((pi + 0.5) / angleBins) * angleMaxDeg);
  }
  peakAngles.sort((a, b) => a - b);
  const angleDeg = peakAngles[Math.floor(peakAngles.length / 2)];
  const peak = Math.max(...acc);
  const energy = acc.map((e, b) => ({
    thetaDeg: ((b + 0.5) / angleBins) * angleMaxDeg,
    e: e / peak,
  }));
  return { angleDeg, energy };
}
