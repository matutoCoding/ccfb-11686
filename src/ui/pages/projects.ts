// 页面 1：方案列表
import { store } from '../../core/store';
import { h, clear } from '../dom';
import { navigate } from '../router';
import { lengthFroude } from '../../core/physics';

export function renderProjectsPage(root: HTMLElement) {
  clear(root);
  const { projects, conditions, hulls } = store.data;

  root.append(
    h('h1', { class: 'page-title' }, '试验方案列表'),
    h('p', { class: 'page-sub' }, '一个方案绑定一条参数化船型，可挂载多组水池试验工况；试验后回填实测波高即可与仿真剖面对比。'),
  );

  const bar = h('div', { class: 'btn-row', style: 'margin-bottom:16px' },
    h('button', {
      class: 'primary',
      onclick: () => {
        const name = prompt('新方案名称', `水池方案 ${projects.length + 1}`);
        if (name) {
          store.addProject(name);
          navigate('condition');
        }
      },
    }, '＋ 新建方案'),
  );
  root.append(bar);

  if (projects.length === 0) {
    root.append(h('div', { class: 'empty' }, '暂无方案，点击「新建方案」开始。'));
    return;
  }

  const grid = h('div', { class: 'grid-auto' });
  for (const proj of projects) {
    const hull = hulls.find((x) => x.id === proj.hullId);
    const conds = conditions.filter((c) => proj.conditionIds.includes(c.id));
    const active = store.data.activeProjectId === proj.id;

    const rows = conds.map((c) => {
      const frL = hull ? lengthFroude(c.speed, hull.lengthBP) : 0;
      const hasMeas = c.measured && c.measured.length > 0;
      return h('tr', {},
        h('td', {}, c.name),
        h('td', { class: 'mono' }, `${c.speed.toFixed(2)} m/s`),
        h('td', { class: 'mono' }, `${c.waterDepth.toFixed(2)} m`),
        h('td', { class: 'mono' }, frL.toFixed(3)),
        h('td', {}, hasMeas ? h('span', { class: 'tag ok' }, `已回填 ${c.measured!.length} 条`) : h('span', { class: 'tag warn' }, '无实测')),
        h('td', {}, h('button', {
          class: 'small',
          onclick: () => {
            store.setActive(proj.id, c.id);
            navigate('simulation');
          },
        }, '仿真')),
      );
    });

    const card = h('div', { class: 'card', style: active ? 'border-color:var(--accent)' : '' },
      h('div', { class: 'btn-row', style: 'justify-content:space-between' },
        h('h2', { style: 'margin:0' }, proj.name + (active ? '　' : ''), active ? h('span', { class: 'tag' }, '当前') : null),
        h('div', { class: 'btn-row' },
          h('button', {
            class: 'small',
            onclick: () => { store.setActive(proj.id, conds[0]?.id); navigate('hull'); },
          }, '船型'),
          h('button', {
            class: 'small',
            onclick: () => { store.setActive(proj.id, conds[0]?.id); navigate('condition'); },
          }, '工况'),
          h('button', {
            class: 'small danger',
            onclick: () => { if (confirm(`删除方案「${proj.name}」及其全部工况？`)) store.removeProject(proj.id); },
          }, '删除'),
        ),
      ),
      h('p', { class: 'muted', style: 'margin:8px 0' }, proj.description || '无描述'),
      h('p', { class: 'muted', style: 'margin:4px 0 12px' },
        `船型：${hull?.name ?? '—'}　Lpp ${hull?.lengthBP ?? 0}m × B ${hull?.beam ?? 0}m × T ${hull?.draft ?? 0}m　工况 ${conds.length} 组`),
      conds.length
        ? h('table', {},
            h('thead', {}, h('tr', {},
              h('th', {}, '工况'), h('th', {}, '船速'), h('th', {}, '水深'), h('th', {}, 'Fr_L'), h('th', {}, '实测'), h('th', {}, ''))),
            h('tbody', {}, ...rows))
        : h('div', { class: 'empty', style: 'padding:20px' }, '该方案还没有工况'),
    );
    grid.append(card);
  }
  root.append(grid);
}
