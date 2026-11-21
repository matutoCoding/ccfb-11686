// 船体渲染：简单 PBR-ish 光照 + 水线标识
struct Camera {
  viewProj: mat4x4<f32>,
  eye: vec4<f32>,
  lightDir: vec4<f32>,
};

@group(0) @binding(0) var<uniform> cam: Camera;

struct VsOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) normal: vec3<f32>,
};

@vertex
fn vs_main(@location(0) position: vec3<f32>, @location(1) normal: vec3<f32>) -> VsOut {
  var out: VsOut;
  // 法线经模型变换（本应用模型只做平移，方向不变；缩放在 CPU 烘焙进顶点）
  out.normal = normalize(normal);
  out.world = position;
  out.clip = cam.viewProj * vec4<f32>(position, 1.0);
  return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let nrm = normalize(in.normal);
  let light = normalize(cam.lightDir);
  let view = normalize(cam.eye - in.world);

  let hullColor = vec3<f32>(0.72, 0.18, 0.14);   // 船壳防锈红
  let deckColor = vec3<f32>(0.78, 0.79, 0.80);
  let base = select(hullColor, deckColor, in.world.y > -0.02);

  let diff = max(dot(nrm, light), 0.0);
  let ambient = vec3<f32>(0.28, 0.32, 0.36);
  let halfV = normalize(view + light);
  let spec = pow(max(dot(nrm, halfV), 0.0), 60.0) * 0.6;

  let color = base * (ambient + vec3<f32>(diff * 0.85)) + vec3<f32>(spec);
  return vec4<f32>(color, 1.0);
}
