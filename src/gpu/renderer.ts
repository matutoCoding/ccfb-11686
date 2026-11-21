// 场景渲染：水面（无顶点缓冲，vertex_index 取高度场）+ 船体网格 + 深度/截图
import waterShader from './wgsl/water.wgsl?raw';
import hullShader from './wgsl/hull.wgsl?raw';
import type { CameraGpu, CameraState } from './camera';
import { buildCameraGpu, defaultCamera } from './camera';

export interface RenderOptions {
  foamEnabled: boolean;
  reflectEnabled: boolean;
  foamThreshold: number;
}

const CAM_SIZE = 128;   // viewProj 64 + eye 16 + lightDir 16 + 补齐
const WATER_UNIFORM_SIZE = 64;

export class SceneRenderer {
  private device: GPUDevice;
  private canvas: HTMLCanvasElement;
  private format: GPUTextureFormat;
  private camBuffer: GPUBuffer;
  private waterUniform: GPUBuffer;
  private waterPipe: GPURenderPipeline;
  private hullPipe: GPURenderPipeline;
  private depthTex: GPUTexture | null = null;
  camera: CameraState;
  private n: number;
  private domain: number;
  private waterIndexBuffer: GPUBuffer;
  private waterIndexCount: number;
  private hullBuffers: { pos: GPUBuffer; idx: GPUBuffer; normal: GPUBuffer; count: number } | null = null;

  constructor(device: GPUDevice, canvas: HTMLCanvasElement, format: GPUTextureFormat, n: number, domain: number) {
    this.device = device;
    this.canvas = canvas;
    this.format = format;
    this.n = n;
    this.domain = domain;
    this.camera = defaultCamera(domain);

    // 水面网格索引：(N-1)×(N-1) 个方块，每块 2 个三角形
    const quadCount = (n - 1) * (n - 1);
    const indexData = new Uint32Array(quadCount * 6);
    let k = 0;
    for (let z = 0; z < n - 1; z++) {
      for (let x = 0; x < n - 1; x++) {
        const a = z * n + x;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        indexData[k++] = a;
        indexData[k++] = c;
        indexData[k++] = b;
        indexData[k++] = b;
        indexData[k++] = c;
        indexData[k++] = d;
      }
    }
    this.waterIndexCount = indexData.length;
    this.waterIndexBuffer = device.createBuffer({
      size: indexData.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.waterIndexBuffer, 0, indexData);

    this.camBuffer = device.createBuffer({ size: CAM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.waterUniform = device.createBuffer({ size: WATER_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    const waterMod = device.createShaderModule({ code: waterShader });
    this.waterPipe = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: waterMod, entryPoint: 'vs_main' },
      fragment: { module: waterMod, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: this.depthState(),
    });

    const hullMod = device.createShaderModule({ code: hullShader });
    this.hullPipe = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: hullMod,
        entryPoint: 'vs_main',
        buffers: [
          { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
          { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
        ],
      },
      fragment: { module: hullMod, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: this.depthState(),
    });
  }

  private depthState(): GPUDepthStencilState {
    return {
      format: 'depth24plus',
      depthWriteEnabled: true,
      depthCompare: 'less',
    };
  }

  private resizeCanvas() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  private ensureDepth() {
    this.resizeCanvas();
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (!this.depthTex || this.depthTex.width !== Math.max(1, w) || this.depthTex.height !== Math.max(1, h)) {
      this.depthTex?.destroy();
      this.depthTex = this.device.createTexture({
        size: [Math.max(1, w), Math.max(1, h)],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
  }

  /** 上传/替换船体网格（坐标平移在 CPU 侧完成） */
  setHullMesh(positions: Float32Array, normals: Float32Array, indices: Uint32Array, offset: [number, number, number]) {
    this.hullBuffers?.pos.destroy();
    this.hullBuffers?.normal.destroy();
    this.hullBuffers?.idx.destroy();
    const shifted = new Float32Array(positions);
    for (let i = 0; i < shifted.length; i += 3) {
      shifted[i] += offset[0];
      shifted[i + 1] += offset[1];
      shifted[i + 2] += offset[2] - this.domain / 2; // 几何 z 以船中为 0，域坐标以角点为 0
    }
    const pos = this.device.createBuffer({
      size: shifted.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(pos, 0, shifted);
    const normal = this.device.createBuffer({
      size: normals.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(normal, 0, normals as unknown as BufferSource);
    const idx = this.device.createBuffer({
      size: indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(idx, 0, indices as unknown as BufferSource);
    this.hullBuffers = { pos, idx, normal, count: indices.length };
  }

  clearHull() {
    this.hullBuffers?.pos.destroy();
    this.hullBuffers?.normal.destroy();
    this.hullBuffers?.idx.destroy();
    this.hullBuffers = null;
  }

  private writeCamera() {
    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    const gpu: CameraGpu = buildCameraGpu(this.camera, aspect);
    const data = new Float32Array(CAM_SIZE / 4);
    data.set(gpu.viewProj, 0);
    data.set(gpu.eye, 16);
    data.set(gpu.lightDir, 20);
    this.device.queue.writeBuffer(this.camBuffer, 0, data);
  }

  private writeWaterUniform(time: number, opts: RenderOptions) {
    const wu = new Float32Array(WATER_UNIFORM_SIZE / 4);
    wu[0] = this.n;
    wu[1] = this.domain;
    wu[2] = this.domain / this.n;
    wu[3] = time;
    wu[4] = opts.foamThreshold;
    wu[5] = opts.foamEnabled ? 1 : 0;
    wu[6] = opts.reflectEnabled ? 1 : 0;
    wu[7] = 0; // _pad0
    wu.set([0.08, 0.32, 0.42], 8);   // waterTint rgb（索引 8,9,10）
    wu[11] = 0;
    wu.set([0.02, 0.12, 0.2], 12);   // depthColor rgb（索引 12,13,14）
    wu[15] = 0;
    this.device.queue.writeBuffer(this.waterUniform, 0, wu);
  }

  render(heightBuffer: GPUBuffer, time: number, opts: RenderOptions) {
    this.ensureDepth();
    this.writeCamera();
    this.writeWaterUniform(time, opts);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.canvas.getContext('webgpu')!.getCurrentTexture().createView(),
        clearValue: { r: 0.72, g: 0.82, b: 0.88, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.depthTex!.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
      },
    });

    // 水面：N² 顶点，每 6 个一组构成网格方块
    const waterBG = this.device.createBindGroup({
      layout: this.waterPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.camBuffer } },
        { binding: 1, resource: { buffer: this.waterUniform } },
        { binding: 2, resource: { buffer: heightBuffer } },
      ],
    });
    pass.setPipeline(this.waterPipe);
    pass.setBindGroup(0, waterBG);
    pass.setIndexBuffer(this.waterIndexBuffer, 'uint32');
    pass.drawIndexed(this.waterIndexCount);

    if (this.hullBuffers) {
      const hullBG = this.device.createBindGroup({
        layout: this.hullPipe.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.camBuffer } }],
      });
      pass.setPipeline(this.hullPipe);
      pass.setBindGroup(0, hullBG);
      pass.setVertexBuffer(0, this.hullBuffers.pos);
      pass.setVertexBuffer(1, this.hullBuffers.normal);
      pass.setIndexBuffer(this.hullBuffers.idx, 'uint32');
      pass.drawIndexed(this.hullBuffers.count);
    }
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  /**
   * 离屏渲染到纹理并读回，叠加工况水印后输出 PNG dataURL。
   */
  async captureWithWatermark(
    lines: string[],
    heightBuffer: GPUBuffer,
    opts: RenderOptions,
  ): Promise<string> {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const tex = this.device.createTexture({
      size: [width, height],
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const depth = this.device.createTexture({
      size: [width, height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.writeCamera();
    this.writeWaterUniform(0, opts);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: tex.createView(),
        clearValue: { r: 0.72, g: 0.82, b: 0.88, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: depth.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
      },
    });
    const waterBG = this.device.createBindGroup({
      layout: this.waterPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.camBuffer } },
        { binding: 1, resource: { buffer: this.waterUniform } },
        { binding: 2, resource: { buffer: heightBuffer } },
      ],
    });
    pass.setPipeline(this.waterPipe);
    pass.setBindGroup(0, waterBG);
    pass.setIndexBuffer(this.waterIndexBuffer, 'uint32');
    pass.drawIndexed(this.waterIndexCount);
    pass.end();

    const bytesPerPixel = this.format === 'rgba8unorm' ? 4 : 4;
    const bufferSize = Math.ceil((width * height * bytesPerPixel) / 256) * 256;
    const staging = this.device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    encoder.copyTextureToBuffer(
      { texture: tex },
      { buffer: staging, bytesPerRow: width * 4, rowsPerImage: height },
      { width, height },
    );
    this.device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const pixels = new Uint8ClampedArray(staging.getMappedRange().slice(0));
    staging.unmap();

    // 2D canvas 叠水印
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d')!;
    const imageData = new ImageData(pixels.slice(0, width * height * 4), width, height);
    ctx.putImageData(imageData, 0, 0);
    ctx.font = '13px "Microsoft YaHei", monospace';
    const pad = 12;
    const lineH = 20;
    const boxH = lines.length * lineH + pad;
    ctx.fillStyle = 'rgba(8, 20, 32, 0.62)';
    ctx.fillRect(pad, height - boxH - pad, 430, boxH);
    ctx.fillStyle = '#dff1ff';
    lines.forEach((line, i) => ctx.fillText(line, pad * 2, height - boxH + lineH * (i + 1)));
    const stamp = `船行波仿真实验室 · ${new Date().toLocaleString('zh-CN')}`;
    ctx.fillStyle = 'rgba(223,241,255,0.75)';
    ctx.font = '11px monospace';
    ctx.fillText(stamp, width - 320, height - 12);

    const url = out.toDataURL('image/png');
    staging.destroy();
    tex.destroy();
    depth.destroy();
    return url;
  }

  destroy() {
    this.camBuffer.destroy();
    this.waterUniform.destroy();
    this.depthTex?.destroy();
    this.waterIndexBuffer.destroy();
    this.hullBuffers?.pos.destroy();
    this.hullBuffers?.normal.destroy();
    this.hullBuffers?.idx.destroy();
  }
}
