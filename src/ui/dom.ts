// 极简 DOM 构建辅助
export type El = HTMLElement;

type Child = El | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | EventListener> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'class') {
      el.className = String(v);
    } else if (k === 'value') {
      (el as HTMLInputElement).value = String(v);
    } else if (typeof v === 'boolean') {
      if (v) el.setAttribute(k, '');
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export function clear(el: El) {
  el.replaceChildren();
}

export function labeledField(
  label: string,
  input: HTMLElement,
  hint?: string,
): HTMLElement {
  return h('label', { class: 'field' },
    h('span', { class: 'field-label' }, label),
    input,
    hint ? h('small', { class: 'field-hint' }, hint) : '',
  );
}

export function numInput(
  value: number,
  onInput: (v: number) => void,
  opts: { min?: number; max?: number; step?: number } = {},
): HTMLInputElement {
  const inp = h('input', {
    type: 'number',
    value,
    ...(opts.min !== undefined ? { min: opts.min } : {}),
    ...(opts.max !== undefined ? { max: opts.max } : {}),
    ...(opts.step !== undefined ? { step: opts.step } : {}),
  });
  inp.addEventListener('input', () => {
    const v = parseFloat(inp.value);
    if (Number.isFinite(v)) onInput(v);
  });
  return inp;
}
