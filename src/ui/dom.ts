// 轻量 DOM 构建辅助（无框架依赖）
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | EventListener | null> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'class') {
      el.className = String(v);
    } else if (k === 'value') {
      (el as HTMLInputElement).value = String(v);
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function labeledField(
  label: string,
  input: HTMLElement,
  hint?: string,
): HTMLElement {
  return h('label', { class: 'field' },
    h('span', { class: 'field-label' }, label),
    input,
    hint ? h('small', { class: 'field-hint' }, hint) : null,
  );
}

export function numberInput(value: number, step: number, onChange: (v: number) => void, min?: number, max?: number) {
  const input = h('input', {
    type: 'number',
    step: String(step),
    value: Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : 0,
  }) as HTMLInputElement;
  if (min !== undefined) input.min = String(min);
  if (max !== undefined) input.max = String(max);
  input.addEventListener('change', () => {
    const v = parseFloat(input.value);
    if (Number.isFinite(v)) onChange(v);
  });
  return input;
}

export function slider(value: number, min: number, max: number, step: number, onChange: (v: number) => void) {
  const wrap = h('div', { class: 'slider-row' });
  const input = h('input', { type: 'range', min, max, step, value }) as HTMLInputElement;
  const out = h('output', {}, String(value));
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    out.textContent = String(Math.round(v * 1000) / 1000);
    onChange(v);
  });
  wrap.append(input, out);
  return wrap;
}
