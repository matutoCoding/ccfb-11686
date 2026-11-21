// 页面 6: 设置(仿真/渲染参数 + 数据导入导出)
import { h, clear, labeledField, numInput } from '../dom.ts';
import { store } from '../../state/store.ts';
import type { AppSettings } from '../../core/types.ts';

export function renderSettingsPage(root: HTMLElement): void {
  clear(root);
  const s = store.data.settings;
  const patch = (p: Partial<AppSettings>) => store.updateSettings(p);

  root.append(
    h('h2', { class: 'page-title' }, '设置'),
    h('p', { class: 'page-sub' }, '仿真网格、谱分量与渲染参数; 修改在下次进入仿真/分析时生效。'),

    h('div', { class: 'card' },
      h('h3', {}, '仿真参数'),
      h('div', { class: 'grid-3' },
        labeledField('网格边长 N (N×N)', numInput(s.gridSize, (v) => patch({ gridSize: v }), { min: 64, max: 1024, step: 64 }),
          '512×512 为推荐性能档位'),
        labeledField('计算域长度 (m)', numInput(s.domainLength, (v) => patch({ domainLength: v }), { min: 20, step: 5 })),
        labeledField('谱积分分量数', numInput(s.spectralComponents, (v) => patch({ spectralComponents: v }), { min: 40, max: 600, step: 20 })),
        labeledField('边界阻尼层占比', numInput(s.fdtdDamping, (v) => patch({ fdtdDamping: v }), { min: 0.02, max: 0.25, step: 0.01 })),
        labeledField('动态层增益', numInput(s.fdtdGain, (v) => patch({ fdtdGain: v }), { min: 0.05, max: 1, step: 0.05 })),
      ),
    ),

    h('div', { class: 'card' },
      h('h3', {}, '渲染参数'),
      h('div', { class: 'grid-3' },
        labeledField('白浪波陡阈值', numInput(s.foamThreshold, (v) => patch({ foamThreshold: v }), { min: 0.1, max: 1.5, step: 0.05 })),
        labeledField('渲染分辨率比例', numInput(s.renderScale, (v) => patch({ renderScale: v }), { min: 0.5, max: 2, step: 0.1 })),
        labeledField('显示 FPS', (() => {
          const cb = h('input', { type: 'checkbox' }) as HTMLInputElement;
          cb.checked = s.showFps;
          cb.addEventListener('change', () => patch({ showFps: cb.checked }));
          return cb;
        })()),
      ),
    ),

    h('div', { class: 'card' },
      h('h3', {}, '项目数据'),
      h('div', { class: 'toolbar' },
        h('button', { onclick: exportData }, '导出全部数据 (JSON)'),
        h('button', { class: 'ghost', onclick: importData }, '导入数据 (JSON)'),
        h('button', {
          class: 'danger',
          onclick: () => { if (confirm('恢复出厂示例数据? 当前全部修改将丢失。')) store.resetAll(); },
        }, '恢复示例数据'),
      ),
      h('p', { class: 'field-hint' }, '数据默认保存在浏览器 localStorage; 清理浏览器数据会丢失, 建议定期导出 JSON。'),
    ),
    h('div', { class: 'card' },
      h('h3', {}, '性能与精度说明'),
      h('ul', { class: 'muted', style: 'line-height:1.9;margin:0;padding-left:18px' },
        h('li', {}, '深水尾迹半角理论值 19.471°; 谱合成实测偏差控制在 1° 以内(见 npm test)。'),
        h('li', {}, '512×512 高度场每帧 2 个计算子步, 主流独显可稳定 ≥30 FPS; 核显可降到 384 或 256。'),
        h('li', {}, '谱分量数越高远场干涉越细腻, 分析页计算量线性增加; 160~320 为推荐区间。'),
        h('li', {}, '本系统为线性势流远场模型, 不含破波/粘性/船体非线性, 用于试验前方案筛选与趋势预判。'),
      ),
    ),
  );
}

function exportData(): void {
  const blob = new Blob([store.exportJson()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ship_wake_project_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importData(): void {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json';
  inp.onchange = () => {
    const f = inp.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (store.importJson(String(reader.result))) alert('导入成功');
      else alert('导入失败: 数据格式不匹配');
    };
    reader.readAsText(f);
  };
  inp.click();
}
