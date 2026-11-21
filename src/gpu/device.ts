// WebGPU 能力检测与适配
export interface GpuCapabilities {
  supported: boolean;
  adapter: GPUAdapter;
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  maxWorkgroupSize: number;
  reason?: string;
}

export async function requestGpu(canvas: HTMLCanvasElement): Promise<GpuCapabilities> {
  if (!('gpu' in navigator)) {
    throw new Error('当前浏览器不支持 WebGPU, 请使用 Chrome/Edge 113+ 或 Safari 18+');
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('未找到可用 GPU 适配器');
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('无法获取 WebGPU canvas context');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  const maxWorkgroupSize =
    Math.min(256, adapter.limits.maxComputeWorkgroupSizeX ?? 256);
  device.lost.then((info) => {
    console.error('WebGPU device lost:', info.message);
  });
  return { supported: true, adapter, device, context, format, maxWorkgroupSize };
}

/** 帧率统计(指数平均) */
export class FpsCounter {
  private smoothed = 60;
  private last = performance.now();
  private frames = 0;
  private acc = 0;

  tick(now: number): number {
    const dt = now - this.last;
    this.last = now;
    if (dt > 0) this.smoothed = this.smoothed * 0.92 + (1000 / dt) * 0.08;
    this.frames++;
    this.acc += dt;
    return this.smoothed;
  }

  get fps() {
    return this.smoothed;
  }
}
