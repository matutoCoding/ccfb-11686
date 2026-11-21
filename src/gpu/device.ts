// WebGPU 设备初始化与共享工具
export interface GpuContext {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  adapter: GPUAdapter;
}

export async function initWebGPU(canvas: HTMLCanvasElement): Promise<GpuContext> {
  if (!navigator.gpu) {
    throw new Error(
      '当前浏览器不支持 WebGPU。请使用 Chrome/Edge 113+ 或最新版 Safari，并确认硬件加速已开启。',
    );
  }
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) throw new Error('未找到可用的 GPU 适配器（可能被虚拟机或驱动拦截）。');
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('无法获取 WebGPU canvas 上下文。');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  device.lost.then((info) => {
    console.error('WebGPU device lost:', info);
  });
  return { device, context, format, adapter };
}

export function createBuffer(
  device: GPUDevice,
  size: number,
  usage: GPUBufferUsageFlags,
  label?: string,
): GPUBuffer {
  return device.createBuffer({ size: Math.ceil(size / 4) * 4, usage, label });
}

export function makeComputePipeline(
  device: GPUDevice,
  shader: string,
  entry = 'main',
): GPUComputePipeline {
  const module = device.createShaderModule({ code: shader });
  return device.createComputePipeline({
    layout: 'auto',
    compute: { module, entryPoint: entry },
  });
}

export function makeBindGroup(
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  entries: GPUBindGroupEntry[],
): GPUBindGroup {
  return device.createBindGroup({
    layout: (pipeline as GPUComputePipeline).getBindGroupLayout(0),
    entries,
  });
}
