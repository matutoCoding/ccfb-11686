// 水动力学基础: 弗劳德数、有限水深色散关系、波数求解
import { GRAVITY, KNOT_TO_MPS } from './types.ts';

export const DEEP_WATER_KEVIN_ANGLE_DEG = 19.471220634; // asin(1/3)

export function knotsToMps(knots: number): number {
  return knots * KNOT_TO_MPS;
}

/** 长度弗劳德数 Fr = V / sqrt(g L) */
export function froudeLength(speedMps: number, length: number): number {
  return speedMps / Math.sqrt(GRAVITY * length);
}

/** 水深弗劳德数 Fh = V / sqrt(g h) */
export function froudeDepth(speedMps: number, depth: number): number {
  return speedMps / Math.sqrt(GRAVITY * depth);
}

/**
 * 有限水深色散关系 omega^2 = g k tanh(k h)
 * 给定 omega 求波数 k。浅水根可能很小, Newton 对初值敏感,
 * 这里用二分法保证全 Fh 范围收敛。
 */
export function wavenumberAt(omega: number, depth: number): number {
  const deepK = (omega * omega) / GRAVITY;
  if (!Number.isFinite(depth) || depth <= 0) return deepK;
  if (deepK * depth > 20) return deepK; // 已属深水波
  // 存在根的前提: omega^2 < g h
  if (omega * omega >= GRAVITY * depth) return NaN;
  // 直接求解 F(k)=g k tanh(kh) = omega^2; F 单调递增,
  // F(deepK)=g·deepK·tanh(...) < omega^2, 故根在 deepK 右侧。
  let lo = deepK;
  let hi = deepK * 2;
  while (GRAVITY * hi * Math.tanh(hi * depth) < omega * omega) {
    hi *= 2;
  }
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    if (GRAVITY * mid * Math.tanh(mid * depth) < omega * omega) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** 相速度 c = omega/k */
export function phaseSpeed(k: number, depth: number): number {
  return Math.sqrt((GRAVITY * Math.tanh(k * depth)) / k);
}

/** 群速比 cg/c = (1 + 2kh/sinh(2kh)) / 2 */
export function groupRatio(k: number, depth: number): number {
  if (!Number.isFinite(depth)) return 0.5;
  const q = 2 * k * depth;
  if (q > 40) return 0.5;
  return 0.5 * (1 + q / Math.sinh(q));
}

/** 浅化因子 S(q)=2q/sinh(2q), 深水趋于 0 */
export function shallowFactor(q: number): number {
  if (q > 40) return 0;
  return (2 * q) / Math.sinh(2 * q);
}

export interface SimNumbers {
  speedMps: number;
  frLength: number;
  fhDepth: number;
  regime: 'deep' | 'subcritical' | 'critical' | 'supercritical';
}

export function computeSimNumbers(
  speedKnots: number,
  length: number,
  deepWater: boolean,
  depth: number,
): SimNumbers {
  const speedMps = knotsToMps(speedKnots);
  const frLength = froudeLength(speedMps, length);
  const fhDepth = deepWater ? 0 : froudeDepth(speedMps, depth);
  let regime: SimNumbers['regime'] = 'deep';
  if (!deepWater) {
    if (fhDepth < 0.9) regime = 'subcritical';
    else if (fhDepth <= 1.1) regime = 'critical';
    else regime = 'supercritical';
  }
  return { speedMps, frLength, fhDepth, regime };
}
