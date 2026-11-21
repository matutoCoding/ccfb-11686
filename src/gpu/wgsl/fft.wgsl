// Cooley-Tukey FFT：位序反转 + 原地蝶形
// 每个工作组处理一条长度 N 的序列（一行或一列）

struct Params {
  n: u32,
  stage: u32,      // 0xFFFF.. 表示位序反转；否则 len = 2 << stage
  sign: u32,       // 1 正变换 / 0 逆变换（用 u32 避免浮点 uniform 问题）
  along: u32,      // 0=沿行 1=沿列
};

@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage, read_write> buf: array<vec2<f32>>;

fn cmul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

fn bitReverse(x: u32, bits: u32) -> u32 {
  var r: u32 = 0u;
  var v = x;
  for (var i = 0u; i < 32u; i++) {
    if (i >= bits) { break; }
    r = (r << 1u) | (v & 1u);
    v = v >> 1u;
  }
  return r;
}

@compute @workgroup_size(256)
fn fft_kernel(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = p.n;
  let tid = gid.x;
  if (tid >= n * n) { return; }

  // seq=序列号(行号或列号)，pos=序列内位置
  var seq: u32;
  var pos: u32;
  if (p.along == 0u) { seq = tid / n; pos = tid % n; }
  else { seq = tid % n; pos = tid / n; }

  // —— 位序反转 ——
  if (p.stage == 0xFFFFFFFFu) {
    let bits = u32(log2(f32(n)));
    let rev = bitReverse(pos, bits);
    if (pos < rev) {
      var ia: u32; var ib: u32;
      if (p.along == 0u) { ia = seq * n + pos; ib = seq * n + rev; }
      else { ia = pos * n + seq; ib = rev * n + seq; }
      let tmp = buf[ia];
      buf[ia] = buf[ib];
      buf[ib] = tmp;
    }
    return;
  }

  // —— 蝶形 ——
  let len = 2u << p.stage;
  let halfLen = len >> 1u;
  let j = pos % len;
  if (j >= halfLen) { return; }   // 每对只由前半线程处理
  let base = pos - j;
  let dir: f32 = select(1.0, -1.0, p.sign == 1u);  // 正变换角为负
  let ang = dir * -6.283185307179586 * f32(j) / f32(len);
  let w = vec2<f32>(cos(ang), sin(ang));

  var ia: u32; var ib: u32;
  if (p.along == 0u) {
    ia = seq * n + base + j;
    ib = seq * n + base + j + halfLen;
  } else {
    ia = (base + j) * n + seq;
    ib = (base + j + halfLen) * n + seq;
  }
  let u = buf[ia];
  let v = cmul(w, buf[ib]);
  buf[ia] = u + v;
  buf[ib] = u - v;
}
