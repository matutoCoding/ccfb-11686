// 二维复数 FFT：位序反转 + 原地 Cooley-Tukey 蝶形，行/列各 log2(N) 级
import fftShader from './wgsl/fft.wgsl?raw';

interface FFTParams {
  n: number;
  stage: number;
  sign: number;
  along: number;
}

const BIT_REVERSE_PASS = 0xffffffff;

export class FFT2D {
  private device: GPUDevice;
  private pipeline: GPUComputePipeline;
  readonly n: number;
  private totalWorkgroups: number;
  // uniform 缓冲池：同一 encoder 内排队的 writeBuffer 不能共用缓冲（提交时会读到最后一次参数），
  // 但每次 run() 之间上一轮命令已提交完成，故可按 pass 序号循环复用固定数量缓冲，避免每步泄漏。
  private paramPool: GPUBuffer[] = [];
  private poolCursor = 0;
  private readonly poolSize: number;

  constructor(device: GPUDevice, n: number) {
    if ((n & (n - 1)) !== 0 || n < 4) throw new Error('FFT 尺寸必须是 ≥4 的 2 的幂');
    this.device = device;
    this.n = n;
    const mod = device.createShaderModule({ code: fftShader });
    this.pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: mod, entryPoint: 'fft_kernel' },
    });
    this.totalWorkgroups = Math.ceil((n * n) / 256);
    // 单次 run 最大 pass 数 = 2 方向 × (1 位序反转 + logN 蝶形)
    this.poolSize = 2 * (1 + this.stages());
    for (let i = 0; i < this.poolSize; i++) {
      this.paramPool.push(device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }));
    }
  }

  private stages() {
    return Math.round(Math.log2(this.n));
  }

  private dispatch(encoder: GPUCommandEncoder, stage: number, sign: number, along: number, buf: GPUBuffer) {
    const paramBuffer = this.paramPool[this.poolCursor % this.poolSize];
    this.poolCursor++;
    this.device.queue.writeBuffer(paramBuffer, 0, new Uint32Array([this.n, stage, sign, along]));
    const bg = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: paramBuffer } },
        { binding: 1, resource: { buffer: buf } },
      ],
    });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(this.totalWorkgroups);
    pass.end();
  }

  /**
   * 原地二维 FFT。
   * @param buf  vec2<f32> storage 缓冲，N² 个复数
   * @param scratch 同尺寸备用缓冲（保留接口兼容；本实现原地工作，不使用）
   * @param inverse true=逆变换（含 1/N² 归一化）
   */
  /** 单方向 FFT（隔离调试用）：along 0=行 1=列 */
  runOneDirection(encoder: GPUCommandEncoder, buf: GPUBuffer, inverse: boolean, along: 0 | 1): void {
    this.poolCursor = 0;
    const sign = inverse ? 0 : 1;
    this.dispatch(encoder, BIT_REVERSE_PASS, sign, along, buf);
    for (let stage = 0; stage < this.stages(); stage++) {
      this.dispatch(encoder, stage, sign, along, buf);
    }
    if (inverse) this.normalize1D(encoder, buf);
  }

  private normalize1D(encoder: GPUCommandEncoder, buf: GPUBuffer) {
    const shader = /* wgsl */ `
      @group(0) @binding(0) var<storage, read_write> data: array<vec2<f32>>;
      @compute @workgroup_size(256)
      fn norm(@builtin(global_invocation_id) gid: vec3<u32>) {
        let total = ${this.n * this.n}u;
        if (gid.x >= total) { return; }
        data[gid.x] = data[gid.x] * vec2<f32>(${1 / this.n});
      }`;
    const mod = this.device.createShaderModule({ code: shader });
    const pipe = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: mod, entryPoint: 'norm' },
    });
    const bg = this.device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: buf } }],
    });
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil((this.n * this.n) / 256));
    pass.end();
  }

  run(encoder: GPUCommandEncoder, buf: GPUBuffer, scratch: GPUBuffer, inverse: boolean): void {
    this.poolCursor = 0;
    // sign: 1=正变换(角 -2π)，0=逆变换(角 +2π)
    const sign = inverse ? 0 : 1;
    for (const along of [0, 1]) {
      this.dispatch(encoder, BIT_REVERSE_PASS, sign, along, buf);
      for (let stage = 0; stage < this.stages(); stage++) {
        this.dispatch(encoder, stage, sign, along, buf);
      }
    }
    if (inverse) this.normalize(encoder, buf);
  }

  private normalize(encoder: GPUCommandEncoder, buf: GPUBuffer) {
    const shader = /* wgsl */ `
      @group(0) @binding(0) var<storage, read_write> data: array<vec2<f32>>;
      @compute @workgroup_size(256)
      fn norm(@builtin(global_invocation_id) gid: vec3<u32>) {
        let total = ${this.n * this.n}u;
        if (gid.x >= total) { return; }
        data[gid.x] = data[gid.x] * vec2<f32>(${1 / (this.n * this.n)});
      }`;
    const mod = this.device.createShaderModule({ code: shader });
    const pipe = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: mod, entryPoint: 'norm' },
    });
    const bg = this.device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: buf } }],
    });
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil((this.n * this.n) / 256));
    pass.end();
  }

  destroy() {
    for (const b of this.paramPool) b.destroy();
  }
}
