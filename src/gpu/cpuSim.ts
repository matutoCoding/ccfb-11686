// CPU 回退高度场仿真: 与 GPU WGSL 相同的线性化波动方程, 供无 WebGPU 环境使用
import { GRAVITY } from '../core/types.ts';
import type { TrialCondition, HullSpec } from '../core/types.ts';
import { computeSimNumbers } from '../core/physics.ts';
import { pressureSourceParams } from '../core/hull.ts';

/** 与 WaterSim 同构的最小接口, 渲染层通过此接口读取高度 */
export interface HeightSource {
  readonly N: number;
  readonly gridCell: number;
  readonly etaBuffer?: GPUBuffer;
  /** CPU 高度数组(仅回退模式存在) */
  cpuHeights?: Float32Array;
  step(substeps?: number): void;
  reset(): void;
  configure(cond: TrialCondition, hull: HullSpec, gain: number): void;
  destroy(): void;
}

export class CpuWaterSim implements HeightSource {
  readonly N: number;
  readonly gridCell: number;
  cpuHeights: Float32Array;
  private w: Float32Array;
  private c2: number;
  private dt: number;
  private srcAmp: number;
  private srcSigma: number;
  private gain: number;
  private spongeCells: number;
  frame = 0;

  constructor(N: number, domainLength: number) {
    this.N = N;
    this.gridCell = domainLength / N;
    this.cpuHeights = new Float32Array(N * N);
    this.w = new Float32Array(N * N);
    this.c2 = GRAVITY * 8;
    const c = Math.sqrt(this.c2);
    this.dt = (0.45 * this.gridCell) / (c * Math.SQRT2);
    this.srcAmp = 0.1;
    this.srcSigma = 6;
    this.gain = 0.35;
    this.spongeCells = Math.round(N * 0.08);
  }

  configure(cond: TrialCondition, hull: HullSpec, gain: number): void {
    const depth = cond.deepWater ? 8 : cond.waterDepth;
    this.c2 = GRAVITY * Math.max(0.5, depth);
    const c = Math.sqrt(this.c2);
    this.dt = (0.45 * this.gridCell) / (c * Math.SQRT2);
    const auto = pressureSourceParams(hull);
    this.srcAmp = cond.pressureAmp || auto.pressureAmp;
    const scaleM = cond.sourceScale || auto.sourceScale;
    this.srcSigma = Math.max(2, scaleM / this.gridCell);
    this.gain = gain;
    void computeSimNumbers;
  }

  step(substeps = 1): void {
    const N = this.N;
    const eta = this.cpuHeights;
    const w = this.w;
    const invCell2 = 1 / (this.gridCell * this.gridCell);
    const cx = N >> 1;
    const cy = N >> 1;
    for (let s = 0; s < substeps; s++) {
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          const xm = x > 0 ? i - 1 : i;
          const xp = x < N - 1 ? i + 1 : i;
          const ym = y > 0 ? i - N : i;
          const yp = y < N - 1 ? i + N : i;
          const lap = (eta[xp] + eta[xm] + eta[yp] + eta[ym] - 4 * eta[i]) * invCell2;
          const dx = x - cx, dy = y - cy;
          const r2 = dx * dx + dy * dy;
          const forcing = -this.srcAmp * Math.exp(-r2 / (2 * this.srcSigma * this.srcSigma));
          w[i] += this.dt * (this.c2 * lap + forcing * this.gain);
        }
      }
      for (let i = 0; i < N * N; i++) eta[i] += this.dt * w[i];
      // 阻尼层
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const d = Math.min(x, N - 1 - x, y, N - 1 - y);
          if (d >= this.spongeCells) continue;
          const t = 1 - d / this.spongeCells;
          const damp = t * t * 0.18;
          const i = y * N + x;
          eta[i] *= 1 - damp;
          w[i] *= 1 - damp;
        }
      }
    }
    this.frame++;
  }

  reset(): void {
    this.cpuHeights.fill(0);
    this.w.fill(0);
    this.frame = 0;
  }

  destroy(): void {
    /* 纯 JS 无需释放 */
  }
}
