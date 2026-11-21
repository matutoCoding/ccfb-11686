// 高度场 GPU 仿真 WGSL: 线性化浅水波动方程 + 移动压力源 + 边界阻尼
// 状态: eta(波面升高) 与 w(垂向速度) 两组 storage buffer, 乒乓切换。

export const SIM_WGSL = /* wgsl */ `
struct Params {
  N: u32,            // 网格边长
  cell: f32,         // 网格间距 m
  dt: f32,           // 时间步 s
  c2: f32,           // 波速平方 g h (m^2/s^2)
  srcX: f32,         // 压力源网格坐标
  srcY: f32,
  srcAmp: f32,       // 压力源强度 (m/s^2 等效)
  srcSigma: f32,     // 压力源高斯尺度(格)
  sponge: f32,       // 阻尼层宽度(格)
  gain: f32,         // 动态层增益
  pad: f32,
};

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> etaIn: array<f32>;
@group(0) @binding(2) var<storage, read_write> wIn: array<f32>;
@group(0) @binding(3) var<storage, read_write> etaOut: array<f32>;

fn idx(x: u32, y: u32) -> u32 { return y * P.N + x; }

fn laplacian(ix: u32, iy: u32) -> f32 {
  let xm = max(ix - 1u, 0u);
  let xp = min(ix + 1u, P.N - 1u);
  let ym = max(iy - 1u, 0u);
  let yp = min(iy + 1u, P.N - 1u);
  let c = etaIn[idx(ix, iy)];
  let inv = 1.0 / (P.cell * P.cell);
  return (etaIn[idx(xp, iy)] + etaIn[idx(xm, iy)] +
          etaIn[idx(ix, yp)] + etaIn[idx(ix, ym)] - 4.0 * c) * inv;
}

// 边界阻尼系数: 距边界 sponge 格内平滑升到 1
fn spongeFactor(ix: u32, iy: u32) -> f32 {
  let d = f32(min(min(ix, P.N - 1u - ix), min(iy, P.N - 1u - iy)));
  let t = clamp(1.0 - d / P.sponge, 0.0, 1.0);
  return t * t;
}

@compute @workgroup_size(8, 8, 1)
fn step(@builtin(global_invocation_id) gid: vec3<u32>) {
  let ix = gid.x;
  let iy = gid.y;
  if (ix >= P.N || iy >= P.N) { return; }
  let i = idx(ix, iy);

  // 移动高斯压力源(随船坐标, 源固定在网格中部, 域随船平移)
  let dx = f32(ix) - P.srcX;
  let dy = f32(iy) - P.srcY;
  let r2 = dx * dx + dy * dy;
  let forcing = -P.srcAmp * exp(-r2 / (2.0 * P.srcSigma * P.srcSigma));

  // 动量: dw/dt = c2 lap(eta) + forcing
  let lap = laplacian(ix, iy);
  var w = wIn[i] + P.dt * (P.c2 * lap + forcing * P.gain);

  // 波面推进: deta/dt = w
  var eta = etaIn[i] + P.dt * w;

  // 边界吸收
  let s = spongeFactor(ix, iy);
  eta = eta * (1.0 - s * 0.18);
  w = w * (1.0 - s * 0.18);

  wIn[i] = w;
  etaOut[i] = eta;
}
`;

export interface SimParamsData {
  N: number;
  cell: number;
  dt: number;
  c2: number;
  srcX: number;
  srcY: number;
  srcAmp: number;
  srcSigma: number;
  sponge: number;
  gain: number;
}

/** 统一缓冲区字节布局(4 字节对齐, 12 个 f32/u32) */
export function packParams(p: SimParamsData): Float32Array {
  const buf = new Float32Array(12);
  buf[0] = p.N;
  buf[1] = p.cell;
  buf[2] = p.dt;
  buf[3] = p.c2;
  buf[4] = p.srcX;
  buf[5] = p.srcY;
  buf[6] = p.srcAmp;
  buf[7] = p.srcSigma;
  buf[8] = p.sponge;
  buf[9] = p.gain;
  buf[10] = 0;
  buf[11] = 0;
  return buf;
}
