// CPU 回退渲染器: 2D Canvas 高度场伪彩 + 等高线 + 高波陡泡沫
import type { HeightSource } from './cpuSim.ts';

export class CpuRenderer {
  foamThreshold = 0.55;
  heightScale = 6;

  constructor(private canvas: HTMLCanvasElement, private sim: HeightSource) {}

  render(): void {
    const N = this.sim.N;
    const h = this.sim.cpuHeights!;
    const canvas = this.canvas;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(2, Math.round(rect.width * dpr));
    const H = Math.max(2, Math.round(rect.height * dpr));
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(N, N);
    const cell = this.sim.gridCell;
    let maxAbs = 1e-6;
    for (let i = 0; i < h.length; i++) maxAbs = Math.max(maxAbs, Math.abs(h[i]));

    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const v = h[i] / maxAbs; // -1..1
        // 波陡(中心差分)
        const xm = h[y * N + Math.max(0, x - 1)];
        const xp = h[y * N + Math.min(N - 1, x + 1)];
        const steep = Math.abs(xp - xm) / (2 * cell);
        const o = i * 4;
        if (steep > this.foamThreshold * 0.12) {
          // 白浪泡沫
          const f = Math.min(1, (steep - this.foamThreshold * 0.12) * 6);
          img.data[o] = 200 + 35 * f;
          img.data[o + 1] = 220 + 25 * f;
          img.data[o + 2] = 228 + 22 * f;
        } else if (v >= 0) {
          // 波峰: 深蓝→亮青
          img.data[o] = 20 + 60 * v;
          img.data[o + 1] = 70 + 110 * v;
          img.data[o + 2] = 110 + 120 * v;
        } else {
          // 波谷: 压暗
          img.data[o] = 10 + 30 * (1 + v);
          img.data[o + 1] = 40 + 60 * (1 + v);
          img.data[o + 2] = 70 + 80 * (1 + v);
        }
        img.data[o + 3] = 255;
      }
    }
    // 先放大绘制(离屏 N×N -> 画布)
    const off = document.createElement('canvas');
    off.width = N; off.height = N;
    off.getContext('2d')!.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, W, H);

    // 压力源位置标记
    const sx = (0.5 * N / N) * W;
    const sy = (0.5 * N / N) * H;
    ctx.strokeStyle = 'rgba(232,176,75,.9)';
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.arc(sx, sy, 10 * dpr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(232,176,75,.95)';
    ctx.font = `${12 * dpr}px sans-serif`;
    ctx.fillText('压力源(船体)', sx + 14 * dpr, sy - 10 * dpr);
  }
}
