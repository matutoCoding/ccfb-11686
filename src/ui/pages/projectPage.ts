// 页面 1: 方案列表(船型 + 工况总览)
import { h, clear } from '../dom.ts';
import { store, defaultCondition } from '../../state/store.ts';
import type { HullSpec, TrialCondition } from '../../core/types.ts';
import { computeSimNumbers } from '../../core/physics.ts';

export function renderProjectPage(root: HTMLElement, go: (page: string, id?: string) => void): void {
  clear(root);
  const { hulls, conditions } = store.data;

  root.append(
    h('h2', { class: 'page-title' }, '方案列表'),
    h('p', { class: 'page-sub' }, '管理船型方案及其挂载的水池试验工况; 每个船型可挂多组工况。'),
  );

  for (const hull of hulls) {
    const conds = conditions.filter((c) => c.hullId === hull.id);
    const card = h('div', { class: 'card' });
    card.append(
      h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:12px' },
        h('h3', { style: 'margin:0' }, `${hull.name}  ·  Lpp ${hull.Lpp}m / B ${hull.B}m / T ${hull.T}m`),
        h('div', { class: 'row' },
          h('button', {
            class: 'ghost sm',
            onclick: () => go('hull', hull.id),
          }, '编辑船型'),
          h('button', {
            class: 'sm',
            onclick: () => {
              store.addCondition(hull.id, { ...defaultCondition(hull.id), name: `工况 ${conds.length + 1}` });
            },
          }, '+ 新工况'),
          h('button', {
            class: 'danger sm',
            onclick: () => { if (confirm(`删除船型「${hull.name}」及其全部工况?`)) store.removeHull(hull.id); },
          }, '删除'),
        ),
      ),
      renderConditionTable(hull, conds, go),
    );
    root.append(card);
  }

  root.append(
    h('button', {
      onclick: () => {
        const hull = store.addHull({ name: `新船型 ${hulls.length + 1}` });
        go('hull', hull.id);
      },
    }, '+ 新建船型方案'),
  );
}

function renderConditionTable(hull: HullSpec, conds: TrialCondition[], go: (p: string, id?: string) => void): HTMLElement {
  if (!conds.length) return h('p', { class: 'muted' }, '尚无工况, 点击「新工况」添加。');
  const table = h('table');
  table.append(
    h('thead', {}, h('tr', {},
      h('th', {}, '工况名称'),
      h('th', {}, '船速 (kn / m·s⁻¹)'),
      h('th', {}, '水深'),
      h('th', {}, 'Fr (长度)'),
      h('th', {}, 'Fh (水深)'),
      h('th', {}, '实测数据'),
      h('th', {}, '操作'),
    )),
  );
  const tbody = h('tbody');
  for (const c of conds) {
    const nums = computeSimNumbers(c.speedKnots, hull.Lpp, c.deepWater, c.waterDepth);
    const regimeTag = c.deepWater
      ? h('span', { class: 'tag deep' }, '深水')
      : h('span', { class: nums.regime === 'supercritical' ? 'tag super' : 'tag shallow' },
          `${c.waterDepth.toFixed(1)}m · ${nums.regime}`);
    tbody.append(h('tr', {},
      h('td', {}, c.name),
      h('td', {}, `${c.speedKnots.toFixed(2)} / ${nums.speedMps.toFixed(2)}`),
      h('td', {}, regimeTag),
      h('td', {}, nums.frLength.toFixed(3)),
      h('td', {}, c.deepWater ? '—' : nums.fhDepth.toFixed(3)),
      h('td', {}, c.measured.length ? `${c.measured.length} 组` : '未回填'),
      h('td', {}, h('div', { class: 'row' },
        h('button', { class: 'sm', onclick: () => go('condition', c.id) }, '编辑'),
        h('button', { class: 'ghost sm', onclick: () => go('sim', c.id) }, '仿真'),
        h('button', { class: 'danger sm', onclick: () => store.removeCondition(c.id) }, '删'),
      )),
    ));
  }
  table.append(tbody);
  return table;
}
