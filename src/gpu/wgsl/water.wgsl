// 水面渲染：高度场顶点置换 + 法线有限差分 + Fresnel + 反射折射 + 白浪泡沫
struct Camera {
  viewProj: mat4x4<f32>,   // 0-63
  eye: vec4<f32>,          // 64-79（xyz + pad）
  lightDir: vec4<f32>,     // 80-95（xyz + pad）
};

struct WaterUniform {
  n: f32,            // 0（JS 用 Float32Array，统一 f32）
  domain: f32,       // 4
  dx: f32,           // 8
  time: f32,         // 12
  foamThreshold: f32, // 16
  foamEnabled: f32,  // 20
  reflectEnabled: f32, // 24
  _pad0: f32,        // 28
  tintR: f32, tintG: f32, tintB: f32, _pad1: f32,   // 32-44
  depthR: f32, depthG: f32, depthB: f32, _pad2: f32, // 48-60
};

@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var<uniform> wu: WaterUniform;
@group(0) @binding(2) var<storage, read> heights: array<f32>;

fn sampleHeight(ix: i32, iz: i32) -> f32 {
  let n = i32(wu.n);
  let cx = clamp(ix, 0, n - 1);
  let cz = clamp(iz, 0, n - 1);
  return heights[cz * n + cx];
}

// 程序化天空（大气渐变 + 太阳盘）
fn skyColor(dir: vec3<f32>, sunDir: vec3<f32>) -> vec3<f32> {
  let up = vec3<f32>(0.0, 1.0, 0.0);
  let t = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  let horizon = vec3<f32>(0.72, 0.82, 0.88);
  let zenith = vec3<f32>(0.16, 0.34, 0.58);
  var col = mix(horizon, zenith, pow(t, 0.8));
  let sd = max(dot(normalize(dir), normalize(sunDir)), 0.0);
  col += vec3<f32>(1.0, 0.92, 0.75) * pow(sd, 350.0) * 3.0;   // 太阳盘
  col += vec3<f32>(1.0, 0.85, 0.65) * pow(sd, 8.0) * 0.18;     // 光晕
  return col;
}

struct VsOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) slope: f32,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VsOut {
  let n = u32(wu.n);
  let ix = vi % n;
  let iz = vi / n;
  let h = heights[iz * n + ix];
  let half = wu.domain * 0.5;
  let x = f32(ix) * wu.dx - half;
  let z = f32(iz) * wu.dx - half;
  let world = vec3<f32>(x, h, z);

  // 中心差分法线（y 向上）
  let hl = sampleHeight(i32(ix) - 1, i32(iz));
  let hr = sampleHeight(i32(ix) + 1, i32(iz));
  let hd = sampleHeight(i32(ix), i32(iz) - 1);
  let hu = sampleHeight(i32(ix), i32(iz) + 1);
  let dhdx = (hr - hl) / (2.0 * wu.dx);
  let dhdz = (hu - hd) / (2.0 * wu.dx);
  let normal = normalize(vec3<f32>(-dhdx, 1.0, -dhdz));

  var out: VsOut;
  out.clip = cam.viewProj * vec4<f32>(world, 1.0);
  out.world = world;
  out.normal = normal;
  out.slope = sqrt(dhdx * dhdx + dhdz * dhdz);
  return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let nrm = normalize(in.normal);
  let viewDir = normalize(cam.eye - in.world);
  let cosTheta = clamp(dot(nrm, viewDir), 0.0, 1.0);

  // Schlick Fresnel（水的 F0≈0.02）
  let f0 = 0.02;
  let fresnel = f0 + (1.0 - f0) * pow(1.0 - cosTheta, 1.0 / 5.0);

  // 反射：相对法线镜像后的天空
  let reflDir = reflect(-viewDir, nrm);
  let refl = skyColor(reflDir, cam.lightDir);

  // 折射体颜色：深浅 + 散射吸收（波长相关的蓝绿衰减近似）
  let waterTint = vec3<f32>(wu.tintR, wu.tintG, wu.tintB);
  let depthColor = vec3<f32>(wu.depthR, wu.depthG, wu.depthB);
  let depthTint = mix(depthColor, waterTint, 0.35);
  let refr = depthTint * (0.55 + 0.45 * cosTheta);

  var color = mix(refr, refl, clamp(fresnel * (0.4 + 0.6 * wu.reflectEnabled), 0.0, 1.0));

  // 太阳高光（Blinn-Phong）
  let halfV = normalize(viewDir + normalize(cam.lightDir));
  let spec = pow(max(dot(nrm, halfV), 0.0), 220.0) * 2.2;
  color += vec3<f32>(1.0, 0.95, 0.85) * spec;

  // 白浪泡沫：波陡超阈值 + 时间闪烁噪声
  if (wu.foamEnabled > 0.5) {
    let steep = in.slope;
    let foamMask = smoothstep(wu.foamThreshold, wu.foamThreshold * 1.8, steep);
    // 哈希噪声让泡沫有破碎感
    let cell = floor(in.world.xz * 3.2 + vec2<f32>(wu.time * 0.7, -wu.time * 0.5));
    let hsh = fract(sin(dot(cell, vec2<f32>(12.9898, 78.233))) * 43758.5453);
    let foam = foamMask * clamp(0.35 + 0.65 * hsh, 0.0, 1.0);
    color = mix(color, vec3<f32>(0.92, 0.95, 0.96), clamp(foam, 0.0, 0.95));
  }

  // 简易距离雾化，融合水天线
  let dist = length(cam.eye - in.world);
  let fog = 1.0 - exp(-dist * 0.0016);
  color = mix(color, vec3<f32>(0.72, 0.82, 0.88), clamp(fog, 0.0, 0.85));

  return vec4<f32>(color, 1.0);
}
