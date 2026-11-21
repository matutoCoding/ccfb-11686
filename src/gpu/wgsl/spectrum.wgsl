// 谱方法时间推进（波数域）+ 空间域消波层 + 压力注入
// 线性自由表面重力波，有限水深色散 ω² = g k tanh(kh)
// 状态：eta(波高 η), phi(自由表面速度势 φ)，复数缓冲存谱系数

struct SpecUniform {
  n: f32,            // 0（JS 用 Float32Array 写入，统一为 f32，比较时再转 u32）
  domain: f32,       // 4
  depth: f32,        // 8
  dt: f32,           // 12
  gravity: f32,      // 16
  shipX: f32,       // 20
  shipZ: f32,       // 24
  sigmaX: f32,      // 28
  sigmaZ: f32,      // 32
  pAmp: f32,        // 36
  spongeW: f32,     // 40
  spongeDamp: f32,  // 44
  time: f32,        // 48
  _pad0: f32,       // 52
  _pad1: f32,       // 56
  _pad2: f32,       // 60
};

@group(0) @binding(0) var<uniform> u: SpecUniform;
@group(0) @binding(1) var<storage, read_write> eta: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> phi: array<vec2<f32>>;

// 谱模式时间推进：含随船移动高斯压力的解析积分
@compute @workgroup_size(8, 8)
fn spectrum_step(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = u32(u.n);
  let ix = gid.x;
  let iz = gid.y;
  if (ix >= n || iz >= n) {
    return;
  }
  let idx = iz * n + ix;

  // DFT 波数（自然序，与 Stockham 输出一致）
  let kx = select(f32(ix) - f32(n), f32(ix), ix < n / 2u) * 6.283185307179586 / u.domain;
  let kz = select(f32(iz) - f32(n), f32(iz), iz < n / 2u) * 6.283185307179586 / u.domain;
  let k = sqrt(kx * kx + kz * kz);

  // 2/3 反混淆截断
  let kmax = (f32(n) / 3.0) * 6.283185307179586 / u.domain;

  if (k > kmax) {
    eta[idx] = vec2<f32>(0.0, 0.0);
    phi[idx] = vec2<f32>(0.0, 0.0);
    return;
  }

  var e = eta[idx];
  var p = phi[idx];

  if (k > 1e-7) {
    let kh = k * u.depth;
    let w2 = u.gravity * k * tanh(kh);
    let w = sqrt(w2);
    let wdt = w * u.dt;
    let csw = cos(wdt);
    let snw = sin(wdt);

    // —— 移动高斯压力的 DFT 谱 ——
    // 连续 FT: p0·2πσxσz·exp(-½(k²σ²))·e^{-i(kxX+kzZ)}
    // 未归一化 DFT 系数 = (N/L)² × 连续FT（二维黎曼和 N²/L²）
    let normDft = (u.n * u.n) / (u.domain * u.domain);
    let gauss = u.pAmp * 6.283185307179586 * u.sigmaX * u.sigmaZ
      * exp(-0.5 * (kx * kx * u.sigmaX * u.sigmaX + kz * kz * u.sigmaZ * u.sigmaZ))
      * normDft;
    let phase = kx * u.shipX + kz * u.shipZ;
    // P̂ = gauss (cosφ - i sinφ)
    let phat = vec2<f32>(gauss * cos(phase), -gauss * sin(phase));

    // 含压自由表面（谱域，P̂ 为等效压力水头，量纲米）：
    //   η̇ = K φ，K = k tanh(kh)；φ̇ = -g η - g P̂
    // 恒压解析解 y(t)=exp(Mt)y0 + M⁻¹(exp(Mt)-I)b，M²=-ω²I：
    //   η' = η cos(ωdt) + (K/ω) φ sin(ωdt) − (K/ω) P̂ sin(ωdt)
    //   φ' = φ cos(ωdt) − (g/ω) η sin(ωdt) + (g/K) P̂ (1−cos(ωdt))
    let K = k * tanh(kh);
    let kOverW = K / w;          // K/ω
    let gOverW = u.gravity / w;  // g/ω
    let gOverK = u.gravity / K;  // g/K
    let pForcingEta = vec2<f32>(-kOverW * snw, 0.0) * phat;
    let pForcingPhi = vec2<f32>(gOverK * (1.0 - csw), 0.0) * phat;

    let e_new = vec2<f32>(csw, 0.0) * e + vec2<f32>(kOverW * snw, 0.0) * p + pForcingEta;
    let p_new = vec2<f32>(csw, 0.0) * p - vec2<f32>(gOverW * snw, 0.0) * e + pForcingPhi;
    e = e_new;
    p = p_new;
  } else {
    // k=0 模式：均值保持零
    e = vec2<f32>(0.0, 0.0);
    p = vec2<f32>(0.0, 0.0);
  }

  eta[idx] = e;
  phi[idx] = p;
}

// 空间域消波：η, φ 实域乘 1-γ(r)，γ 仅在边界 sponge 带内 >0
@compute @workgroup_size(8, 8)
fn sponge_apply(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = u32(u.n);
  let ix = gid.x;
  let iz = gid.y;
  if (ix >= n || iz >= n) {
    return;
  }
  let idx = iz * n + ix;
  let x = (f32(ix) + 0.5) * u.domain / f32(n);
  let z = (f32(iz) + 0.5) * u.domain / f32(n);
  let half = u.domain * 0.5;
  let dx = max(0.0, abs(x - half) - (half - u.spongeW));
  let dz = max(0.0, abs(z - half) - (half - u.spongeW));
  let d = max(dx, dz) / u.spongeW;
  let gamma = u.spongeDamp * u.dt * d * d;
  let keep = clamp(1.0 - gamma, 0.0, 1.0);
  // 此时缓冲里是实域数据，虚部应为 ~0，一并衰减
  eta[idx] = eta[idx] * vec2<f32>(keep, keep);
  phi[idx] = phi[idx] * vec2<f32>(keep, keep);
}
