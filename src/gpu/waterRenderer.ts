// 水面渲染器: 轨道相机 + 高度场网格 + 仿真主循环
import { RENDER_WGSL } from './renderShader.ts';
import type { WaterSim } from './waterSim.ts';

export interface OrbitCamera {
  yaw: number;
  pitch: number;
  distance: number;
  target: [number, number, number];
}

type Mat4 = Float32Array;

function perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = far / (near - far);
  m[11] = -1;
  m[14] = (far * near) / (near - far);
  return m;
}

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

function lookAt(eye: [number, number, number], target: [number, number, number], up: [number, number, number]): Mat4 {
  const zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  const zl = Math.hypot(zx, zy, zz);
  const fz0 = zx / zl, fz1 = zy / zl, fz2 = zz / zl;
  let xx = up[1] * fz2 - up[2] * fz1;
  let xy = up[2] * fz0 - up[0] * fz2;
  let xz = up[0] * fz1 - up[1] * fz0;
  const xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl; xy /= xl; xz /= xl;
  const yx = fz1 * xz - fz2 * xy;
  const yy = fz2 * xx - fz0 * xz;
  const yz = fz0 * xy - fz1 * xx;
  const m = new Float32Array(16);
  m[0] = xx; m[1] = yx; m[2] = fz0; m[3] = 0;
  m[4] = xy; m[5] = yy; m[6] = fz1; m[7] = 0;
  m[8] = xz; m[9] = yz; m[10] = fz2; m[11] = 0;
  m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  m[14] = -(fz0 * eye[0] + fz1 * eye[1] + fz2 * eye[2]);
  m[15] = 1;
  return m;
}

export class WaterRenderer {
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private format: GPUTextureFormat;
  private pipeline: GPURenderPipeline;
  private cameraBuf: GPUBuffer;
  private paramBuf: GPUBuffer;
  private indexBuf: GPUBuffer;
  private indexCount: number;
  private depthView: GPUTextureView;
  private bindGroup: GPUBindGroup;
  camera: OrbitCamera = { yaw: 0.6, pitch: 0.5, distance: 70, target: [0, 0, 0] };
  heightScale = 6;
  foamThreshold = 0.55;
  private canvas: HTMLCanvasElement;

  constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
    canvas: HTMLCanvasElement,
    sim: WaterSim,
  ) {
    this.device = device;
    this.context = context;
    this.format = format;
    this.canvas = canvas;
    const N = sim.N;

    const module = device.createShaderModule({ code: RENDER_WGSL });
    this.cameraBuf = device.createBuffer({ size: 88, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.paramBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // 每格两个三角形的索引缓冲
    const vertsPerRow = N;
    const cells = (N - 1) * (N - 1);
    const indices = new Uint32Array(cells * 6);
    let p = 0;
    for (let y = 0; y < N - 1; y++) {
      for (let x = 0; x < N - 1; x++) {
        const a = y * vertsPerRow + x;
        const b = a + 1;
        const c = a + vertsPerRow;
        const d = c + 1;
        indices[p++] = a; indices[p++] = c; indices[p++] = b;
        indices[p++] = b; indices[p++] = c; indices[p++] = d;
      }
    }
    this.indexCount = indices.length;
    this.indexBuf = device.createBuffer({
      size: indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.indexBuf, 0, indices);

    const depthTex = device.createTexture({
      size: [canvas.width, canvas.height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depthView = depthTex.createView();

    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });

    this.bindGroup = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.cameraBuf } },
        { binding: 1, resource: { buffer: this.paramBuf } },
        { binding: 2, resource: { buffer: sim.etaBuffer } },
      ],
    });
  }

  private eye(): [number, number, number] {
    const { yaw, pitch, distance, target } = this.camera;
    const cp = Math.cos(pitch);
    return [
      target[0] + distance * cp * Math.sin(yaw),
      target[1] + distance * Math.sin(pitch),
      target[2] + distance * cp * Math.cos(yaw),
    ];
  }

  resize() {
    const depthTex = this.device.createTexture({
      size: [this.canvas.width, this.canvas.height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depthView = depthTex.createView();
  }

  render(sim: WaterSim, time: number) {
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const eye = this.eye();
    const proj = perspective((50 * Math.PI) / 180, aspect, 0.1, 1000);
    const view = lookAt(eye, this.camera.target, [0, 1, 0]);
    const viewProj = multiply(proj, view);

    // Camera 结构: viewProj(16f) + eye(3f) + lightDir(3f) = 22f = 88 字节
    const camBytes = new Float32Array(22);
    camBytes.set(viewProj, 0);
    camBytes.set(eye, 16);
    camBytes.set([0.45, 0.85, 0.35], 19);
    this.device.queue.writeBuffer(this.cameraBuf, 0, camBytes);

    const rp = new Float32Array(8);
    rp[0] = sim.N;
    rp[1] = sim.gridCell;
    rp[2] = this.heightScale;
    rp[3] = this.foamThreshold;
    rp[4] = time;
    this.device.queue.writeBuffer(this.paramBuf, 0, rp);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0.62, g: 0.74, b: 0.82, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.depthView,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setIndexBuffer(this.indexBuf, 'uint32');
    pass.drawIndexed(this.indexCount);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }
}
