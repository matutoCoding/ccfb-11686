// 轨道相机：球坐标 + 可选跟随船体；输出 view-proj 矩阵
export interface CameraState {
  yaw: number;       // 方位角（弧度）
  pitch: number;     // 俯仰角（弧度）
  distance: number;  // 视距
  target: [number, number, number];
  fov: number;
}

export function defaultCamera(domain: number): CameraState {
  return {
    yaw: -Math.PI * 0.18,
    pitch: Math.PI * 0.22,
    distance: domain * 0.75,
    target: [0, 0, 0],
    fov: Math.PI / 4.2,
  };
}

export function cameraEye(c: CameraState): [number, number, number] {
  const cp = Math.cos(c.pitch);
  return [
    c.target[0] + c.distance * cp * Math.sin(c.yaw),
    c.target[1] + c.distance * Math.sin(c.pitch),
    c.target[2] + c.distance * cp * Math.cos(c.yaw),
  ];
}

// 列主序 4x4（适配 WGSL mat4x4）
function perspective(fov: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fov / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, far * nf, -1,
    0, 0, near * far * nf, 0,
  ]);
}

function lookAt(eye: number[], target: number[], up: number[]): Float32Array {
  const z = norm3(sub3(eye, target));
  const x = norm3(cross3(up, z));
  const y = cross3(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1,
  ]);
}

function mul4(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

function sub3(a: number[], b: number[]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross3(a: number[], b: number[]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot3(a: number[], b: number[]) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function norm3(a: number[]): [number, number, number] {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

export interface CameraGpu {
  viewProj: Float32Array;
  eye: Float32Array;
  lightDir: Float32Array;
}

export function buildCameraGpu(state: CameraState, aspect: number): CameraGpu {
  const eye = cameraEye(state);
  const view = lookAt(eye, state.target, [0, 1, 0]);
  const proj = perspective(state.fov, aspect, 0.5, 5000);
  const light = norm3([-0.45, 0.8, 0.35]);
  return {
    viewProj: mul4(proj, view),
    eye: new Float32Array([...eye, 0]),
    lightDir: new Float32Array([...light, 0]),
  };
}

/** 鼠标/触控轨道控制，返回解绑函数 */
export function attachOrbitControls(
  canvas: HTMLCanvasElement,
  state: CameraState,
  onChange: () => void,
): () => void {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const down = (e: PointerEvent) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  };
  const up = (e: PointerEvent) => {
    dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  };
  const move = (e: PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    state.yaw += dx * 0.006;
    state.pitch = Math.max(0.05, Math.min(Math.PI / 2 - 0.03, state.pitch + dy * 0.005));
    onChange();
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    state.distance *= 1 + Math.sign(e.deltaY) * 0.08;
    state.distance = Math.max(10, Math.min(3000, state.distance));
    onChange();
  };

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('wheel', wheel, { passive: false });
  return () => {
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('wheel', wheel);
  };
}
