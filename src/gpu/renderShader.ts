// 水面渲染 WGSL: 高度场位移网格 + 菲涅尔 + 折射近似 + 波陡白浪泡沫
export const RENDER_WGSL = /* wgsl */ `
struct Camera {
  viewProj: mat4x4<f32>,
  eye: vec3<f32>,
  lightDir: vec3<f32>,
};
struct RenderParams {
  N: u32,
  cell: f32,
  heightScale: f32,
  foamThreshold: f32,
  time: f32,
  pad: f32,
};

@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var<uniform> rp: RenderParams;
@group(0) @binding(2) var<storage, read> heights: array<f32>;

struct VSOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) steepness: f32,
};

fn hAt(ix: i32, iy: i32) -> f32 {
  let x = clamp(ix, 0, i32(rp.N) - 1);
  let y = clamp(iy, 0, i32(rp.N) - 1);
  return heights[y * i32(rp.N) + x] * rp.heightScale;
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  let n = rp.N;
  let ix = i32(vi % n);
  let iy = i32(vi / n);
  let x = (f32(ix) - f32(n) * 0.5) * rp.cell;
  let z = (f32(iy) - f32(n) * 0.5) * rp.cell;
  let h = hAt(ix, iy);

  // 中心差分法线
  let hx = hAt(ix + 1, iy) - hAt(ix - 1, iy);
  let hz = hAt(ix, iy + 1) - hAt(ix, iy - 1);
  let normal = normalize(vec3<f32>(-hx / (2.0 * rp.cell), 1.0, -hz / (2.0 * rp.cell)));
  let steep = length(vec2<f32>(hx, hz)) / (2.0 * rp.cell);

  var out: VSOut;
  let world = vec3<f32>(x, h, z);
  out.world = world;
  out.normal = normal;
  out.steepness = steep;
  out.clip = cam.viewProj * vec4<f32>(world, 1.0);
  return out;
}

fn skyColor(dir: vec3<f32>) -> vec3<f32> {
  let t = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  let horizon = vec3<f32>(0.72, 0.82, 0.88);
  let zenith = vec3<f32>(0.20, 0.42, 0.62);
  return mix(horizon, zenith, t);
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let n = normalize(in.normal);
  let viewDir = normalize(cam.eye - in.world);
  // Schlick 菲涅尔
  let f0 = 0.02;
  let fres = f0 + (1.0 - f0) * pow(clamp(1.0 - max(dot(n, viewDir), 0.0), 0.0, 1.0), 5.0);

  let reflected = reflect(-viewDir, n);
  let reflCol = skyColor(reflected);
  // 折射近似: 水下深色 + 视角变浅
  let refrCol = mix(vec3<f32>(0.02, 0.16, 0.20), vec3<f32>(0.10, 0.35, 0.40),
                    clamp(dot(n, viewDir), 0.0, 1.0));

  var col = mix(refrCol, reflCol, clamp(fres, 0.0, 1.0));

  // 漫反射光照
  let ndl = max(dot(n, normalize(cam.lightDir)), 0.0);
  col = col * (0.55 + 0.45 * ndl);

  // 高光
  let halfV = normalize(viewDir + normalize(cam.lightDir));
  let spec = pow(max(dot(n, halfV), 0.0), 90.0) * 0.6;
  col = col + vec3<f32>(spec);

  // 白浪泡沫: 波陡超阈值, 带噪声打散
  let foam = smoothstep(rp.foamThreshold, rp.foamThreshold * 1.4, in.steepness);
  let foamNoise = fract(sin(dot(in.world.xz, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  let foamMask = clamp(foam * (0.6 + 0.4 * foamNoise), 0.0, 1.0);
  col = mix(col, vec3<f32>(0.92, 0.95, 0.96), foamMask);

  return vec4<f32>(col, 1.0);
}
`;
