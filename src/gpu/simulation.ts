// 谱方法船行波仿真引擎：压力源移动 + FFT 色散推进 + 消波层
import spectrumShader from './wgsl/spectrum.wgsl?raw';
import { FFT2D } from './fft';

export interface SimConfig {
  gridN: number;
  domainLength: number;
  depth: number;          // 水深 h (m)
  speed: number;          // 船速 U (m/s)
  cfl: number;
  spongeWidthRatio: number;
  dampingStrength: number;
  pressureAmp: number;    // 等效压力水头 (m)
  pressureLength: number; // σx = pressureLength × L
  pressureWidth: number;  // σz = pressureWidth × B
  hullLength: number;
  hullBeam: number;
  gravity: number;
}

// 与 WGSL SpecUniform 布局一致（16 个 f32 = 64 字节，含尾部 padding）
const UNIFORM_FLOATS = 16;

export class WaveSimulation {
  readonly device: GPUDevice;
  readonly n: number;
  private fft: FFT2D;
  private etaBuf: GPUBuffer;      // vec2<f32> N²（谱/实域复用）
  private phiBuf: GPUBuffer;
  private scratch: GPUBuffer;     // FFT ping-pong
  private heightBuf: GPUBuffer;   // f32 N²，实域波高（渲染/读回用）
  private uniformBuffer: GPUBuffer;
  private stepPipe: GPUComputePipeline;
  private spongePipe: GPUComputePipeline;
  private extractPipe: GPUComputePipeline;
  private cfg: SimConfig;
  private time = 0;
  private dt: number;
  private shipX: number;
  private shipZ: number;
  private startX: number;
  readonly cell: number;

  constructor(device: GPUDevice, cfg: SimConfig) {
    this.device = device;
    this.cfg = cfg;
    this.n = cfg.gridN;
    this.cell = cfg.domainLength / cfg.gridN;
    this.fft = new FFT2D(device, cfg.gridN);

    const count = cfg.gridN * cfg.gridN;
    const storageUsage =
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    this.etaBuf = device.createBuffer({ size: count * 8, usage: storageUsage, label: 'eta' });
    this.phiBuf = device.createBuffer({ size: count * 8, usage: storageUsage, label: 'phi' });
    this.scratch = device.createBuffer({ size: count * 8, usage: storageUsage, label: 'fft_scratch' });
    this.heightBuf = device.createBuffer({ size: count * 4, usage: storageUsage | GPUBufferUsage.COPY_SRC, label: 'height' });
    this.uniformBuffer = device.createBuffer({
      size: UNIFORM_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });

    const mod = device.createShaderModule({ code: spectrumShader });
    this.stepPipe = device.createComputePipeline({
      layout: 'auto',
      compute: { module: mod, entryPoint: 'spectrum_step' },
    });
    this.spongePipe = device.createComputePipeline({
      layout: 'auto',
      compute: { module: mod, entryPoint: 'sponge_apply' },
    });
    const extractMod = device.createShaderModule({ code: extractShader(cfg.gridN) });
    this.extractPipe = device.createComputePipeline({
      layout: 'auto',
      compute: { module: extractMod, entryPoint: 'extract_real' },
    });

    // dt：由最快群速度（浅水极限 √gh）限制
    const cgMax = Math.sqrt(cfg.gravity * cfg.depth);
    this.dt = Math.min(
      cfg.cfl * this.cell / Math.max(cgMax, 0.5),
      0.5 * this.cell / Math.max(cfg.speed, 0.1),
    );

    // 船从域内 1/4 处出发，沿 +x 航行
    this.startX = cfg.domainLength * 0.25;
    this.shipX = this.startX;
    this.shipZ = cfg.domainLength * 0.5;
    this.writeUniform();
  }

  get timeStep() {
    return this.dt;
  }
  get simTime() {
    return this.time;
  }
  get shipPosition() {
    return { x: this.shipX, z: this.shipZ };
  }
  get heightBuffer() {
    return this.heightBuf;
  }
  get domainLength() {
    return this.cfg.domainLength;
  }

  private writeUniform() {
    const c = this.cfg;
    const data = new Float32Array(UNIFORM_FLOATS).map((_, i) => {
      switch (i) {
        case 0: return c.gridN;
        case 1: return c.domainLength;
        case 2: return c.depth;
        case 3: return this.dt;
        case 4: return c.gravity;
        case 5: return this.shipX;
        case 6: return this.shipZ;
        case 7: return c.pressureLength * c.hullLength;
        case 8: return c.pressureWidth * c.hullBeam;
        case 9: return c.pressureAmp;
        case 10: return c.spongeWidthRatio * c.domainLength;
        case 11: return c.dampingStrength;
        default: return 0;
      }
    });
    // 末尾再补 time（WGSL 结构体实际 13 个 float，这里扩到 16 对齐）
    const padded = new Float32Array(16);
    padded.set(data);
    padded[12] = this.time;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, padded);
  }

  reset() {
    const count = this.n * this.n;
    this.device.queue.writeBuffer(this.etaBuf, 0, new Float32Array(count * 2));
    this.device.queue.writeBuffer(this.phiBuf, 0, new Float32Array(count * 2));
    this.time = 0;
    this.shipX = this.startX;
    this.writeUniform();
  }

  /** 推进一个时间步（船速在内部积分，平滑加速降低启动瞬态） */
  step() {
    const c = this.cfg;
    // 前 20 秒线性加速到目标航速，减小初始冲击
    const ramp = Math.min(1, this.time / 20);
    this.shipX += c.speed * ramp * this.dt;
    // 抵达消波带前自动回绕（配合相机跟随，视觉上是无限水池）
    const limit = c.domainLength * (1 - c.spongeWidthRatio - 0.02);
    if (this.shipX > limit) {
      this.shipX = this.startX;
    }
    this.time += this.dt;
    this.writeUniform();

    const encoder = this.device.createCommandEncoder();

    // 1) η, φ 实域 -> 谱域（两次 FFT）
    this.fft.run(encoder, this.etaBuf, this.scratch, false);
    this.fft.run(encoder, this.phiBuf, this.scratch, false);

    // 2) 谱模式时间推进（含压力源）
    const stepBG = this.device.createBindGroup({
      layout: this.stepPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.etaBuf } },
        { binding: 2, resource: { buffer: this.phiBuf } },
      ],
    });
    let pass = encoder.beginComputePass();
    pass.setPipeline(this.stepPipe);
    pass.setBindGroup(0, stepBG);
    pass.dispatchWorkgroups(Math.ceil(this.n / 8), Math.ceil(this.n / 8));
    pass.end();

    // 3) 谱域 -> 实域
    this.fft.run(encoder, this.etaBuf, this.scratch, true);
    this.fft.run(encoder, this.phiBuf, this.scratch, true);

    // 4) 空间域消波层
    const spongeBG = this.device.createBindGroup({
      layout: this.spongePipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.etaBuf } },
        { binding: 2, resource: { buffer: this.phiBuf } },
      ],
    });
    pass = encoder.beginComputePass();
    pass.setPipeline(this.spongePipe);
    pass.setBindGroup(0, spongeBG);
    pass.dispatchWorkgroups(Math.ceil(this.n / 8), Math.ceil(this.n / 8));
    pass.end();

    // 5) 提取实部波高到 f32 缓冲
    const extBG = this.device.createBindGroup({
      layout: this.extractPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.etaBuf } },
        { binding: 1, resource: { buffer: this.heightBuf } },
      ],
    });
    pass = encoder.beginComputePass();
    pass.setPipeline(this.extractPipe);
    pass.setBindGroup(0, extBG);
    // N² 个元素，每 workgroup 256 线程
    pass.dispatchWorkgroups(Math.ceil((this.n * this.n) / 256), 1);
    pass.end();

    this.device.queue.submit([encoder.finish()]);
  }

  /** 异步读回整个高度场（分析/快照用） */
  async readbackHeights(): Promise<Float32Array> {
    const count = this.n * this.n;
    const staging = this.device.createBuffer({
      size: count * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.heightBuf, 0, staging, 0, count * 4);
    this.device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();
    return out;
  }

  destroy() {
    this.fft.destroy();
    for (const b of [this.etaBuf, this.phiBuf, this.scratch, this.heightBuf, this.uniformBuffer]) {
      b.destroy();
    }
  }
}

function extractShader(n: number): string {
  return /* wgsl */ `
@group(0) @binding(0) var<storage, read> src: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> dst: array<f32>;
@compute @workgroup_size(256)
fn extract_real(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= ${n * n}u) { return; }
  dst[gid.x] = src[gid.x].x;
}`;
}
