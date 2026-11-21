// 高度场仿真引擎: 管理 GPU buffer/管线, 提供步进与高度读回
import { packParams, SIM_WGSL, type SimParamsData } from './simShader.ts';
import { GRAVITY } from '../core/types.ts';
import type { TrialCondition, HullSpec } from '../core/types.ts';
import { computeSimNumbers } from '../core/physics.ts';
import { pressureSourceParams } from '../core/hull.ts';

export class WaterSim {
  readonly device: GPUDevice;
  readonly N: number;
  private cell: number;
  private etaA: GPUBuffer;
  private etaB: GPUBuffer;
  private wBuf: GPUBuffer;
  private paramBuf: GPUBuffer;
  private pipeline: GPUComputePipeline;
  private bindGroup: GPUBindGroup;
  private readback: GPUBuffer;
  private c2: number;
  private dt: number;
  private srcSigmaCells: number;
  private srcAmp: number;
  private gain: number;
  private spongeCells: number;
  frame = 0;

  constructor(device: GPUDevice, N: number, domainLength: number) {
    this.device = device;
    this.N = N;
    this.cell = domainLength / N;
    const bytes = N * N * 4;

    this.etaA = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.etaB = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.wBuf = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.paramBuf = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.readback = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });

    const module = device.createShaderModule({ code: SIM_WGSL });
    this.pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'step' },
    });
    this.bindGroup = this.makeBindGroup(this.etaA, this.etaB);

    // CFL 稳定条件: dt <= cell / (c sqrt(2)); 取 0.45 倍留余量
    const depth = 8;
    this.c2 = GRAVITY * depth;
    const c = Math.sqrt(this.c2);
    this.dt = (0.45 * this.cell) / (c * Math.SQRT2);
    this.srcSigmaCells = 6;
    this.srcAmp = 0.0;
    this.gain = 0.35;
    this.spongeCells = Math.round(N * 0.08);
  }

  private makeBindGroup(src: GPUBuffer, dst: GPUBuffer): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.paramBuf } },
        { binding: 1, resource: { buffer: src } },
        { binding: 2, resource: { buffer: this.wBuf } },
        { binding: 3, resource: { buffer: dst } },
      ],
    });
  }

  /** 按工况配置压力源与波速 */
  configure(cond: TrialCondition, hull: HullSpec, settingsGain: number) {
    const nums = computeSimNumbers(cond.speedKnots, hull.Lpp, cond.deepWater, cond.waterDepth);
    const depth = cond.deepWater ? 8 : cond.waterDepth;
    this.c2 = GRAVITY * Math.max(0.5, depth);
    const c = Math.sqrt(this.c2);
    this.dt = (0.45 * this.cell) / (c * Math.SQRT2);
    const auto = pressureSourceParams(hull);
    this.srcAmp = cond.pressureAmp || auto.pressureAmp;
    const scaleM = cond.sourceScale || auto.sourceScale;
    this.srcSigmaCells = Math.max(2, scaleM / this.cell);
    this.gain = settingsGain;
    void nums;
  }

  /** 每个仿真子步执行; substeps 控制每帧物理迭代次数 */
  step(substeps = 1, srcOffsetCells = 0) {
    const N = this.N;
    for (let s = 0; s < substeps; s++) {
      const params: SimParamsData = {
        N,
        cell: this.cell,
        dt: this.dt,
        c2: this.c2,
        srcX: N * 0.5 + srcOffsetCells,
        srcY: N * 0.5,
        srcAmp: this.srcAmp,
        srcSigma: this.srcSigmaCells,
        sponge: this.spongeCells,
        gain: this.gain,
      };
      this.device.queue.writeBuffer(this.paramBuf, 0, packParams(params));
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, this.bindGroup);
      pass.dispatchWorkgroups(Math.ceil(N / 8), Math.ceil(N / 8));
      pass.end();
      // 乒乓: etaA(读) -> etaB(写)
      encoder.copyBufferToBuffer(this.etaB, 0, this.etaA, 0, N * N * 4);
      this.device.queue.submit([encoder.finish()]);
    }
    this.frame++;
  }

  get etaBuffer(): GPUBuffer {
    return this.etaA;
  }

  /** 清零波面与垂向速度 */
  reset() {
    const zeros = new Float32Array(this.N * this.N);
    this.device.queue.writeBuffer(this.etaA, 0, zeros);
    this.device.queue.writeBuffer(this.etaB, 0, zeros);
    this.device.queue.writeBuffer(this.wBuf, 0, zeros);
    this.frame = 0;
  }

  get gridCell(): number {
    return this.cell;
  }

  get timestep(): number {
    return this.dt;
  }

  /** CPU 读回高度场(分析页/截图测量用, 异步) */
  async readHeights(): Promise<Float32Array> {
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.etaA, 0, this.readback, 0, this.N * this.N * 4);
    this.device.queue.submit([encoder.finish()]);
    await this.readback.mapAsync(GPUMapMode.READ);
    const copy = new Float32Array(this.N * this.N);
    copy.set(new Float32Array(this.readback.getMappedRange()));
    this.readback.unmap();
    return copy;
  }

  /** 沿船长方向(中线 y=N/2)取纵向剖面 */
  async sampleLongitudinal(): Promise<{ x: number; z: number }[]> {
    const h = await this.readHeights();
    const out: { x: number; z: number }[] = [];
    const mid = this.N >> 1;
    for (let i = 0; i < this.N; i++) {
      out.push({ x: (i - this.N / 2) * this.cell, z: h[mid * this.N + i] });
    }
    return out;
  }

  destroy() {
    this.etaA.destroy();
    this.etaB.destroy();
    this.wBuf.destroy();
    this.paramBuf.destroy();
    this.readback.destroy();
  }
}
