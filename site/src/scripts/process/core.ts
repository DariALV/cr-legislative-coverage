// Shared helpers of the process page's client scripts: theme colors resolved for canvas, SVG and ECharts,
// the "themechange" event, lazy start of each visual and small DOM builders.

export type Rgb = [number, number, number];

const root = document.documentElement;
const probe = document.createElement('canvas');
probe.width = probe.height = 1;
const probeContext = probe.getContext('2d', { willReadFrequently: true });
const resolved = new Map<string, Rgb>();

// Registered first, so every other listener reads fresh colors.
document.addEventListener('themechange', () => resolved.clear());

export const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Current value of a theme token, as written in the CSS (may be an oklch(from ...) expression). */
export function token(name: string): string {
  return getComputedStyle(root).getPropertyValue(name).trim();
}

/** A theme token ("--accent") or any CSS color as [r, g, b], painted once on a 1 px canvas. */
export function rgb(value: string): Rgb {
  const cached = resolved.get(value);
  if (cached) return cached;
  let result: Rgb = [128, 128, 128];
  if (probeContext) {
    probeContext.clearRect(0, 0, 1, 1);
    probeContext.fillStyle = '#808080';
    probeContext.fillStyle = value.startsWith('--') ? token(value) : value;
    probeContext.fillRect(0, 0, 1, 1);
    const [r, g, b] = probeContext.getImageData(0, 0, 1, 1).data;
    result = [r, g, b];
  }
  resolved.set(value, result);
  return result;
}

export const color = (value: string): string => `rgb(${rgb(value).join(', ')})`;
export const alpha = (value: string, opacity: number): string => `rgba(${rgb(value).join(', ')}, ${opacity})`;

/** Blend of two tokens or colors: t = 0 gives a, t = 1 gives b. */
export function mix(a: string, b: string, t: number): string {
  const x = rgb(a), y = rgb(b);
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(', ')})`;
}

/** Color of a point on the diverging scale: -1 (against) to 0 (neutral) to 1 (in favor). */
export function diverging(value: number): string {
  const t = Math.max(-1, Math.min(1, value));
  return t < 0 ? mix('--div-mid', '--div-neg', -t) : mix('--div-mid', '--div-pos', t);
}

/** Color of a point on the sequential scale, 0 to 1. */
export const sequential = (value: number): string => mix('--seq-low', '--seq-high', Math.max(0, Math.min(1, value)));

export const categorical = (index: number): string => color(`--cat-${(index % 8) + 1}`);

/** Runs the callback after every change of mode or style. */
export function onTheme(callback: () => void): void {
  document.addEventListener('themechange', callback);
}

/** Runs the callback once, the first time the element comes into view. */
export function whenVisible(element: Element, run: () => void, rootMargin = '0px 0px -8% 0px'): void {
  if (!('IntersectionObserver' in window)) { run(); return; }
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) { observer.disconnect(); run(); }
  }, { rootMargin });
  observer.observe(element);
}

/** Data placed in the page by Astro as <script type="application/json" id="...">. */
export function readData<T>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing data element #${id}`);
  return JSON.parse(element.textContent ?? 'null') as T;
}

type Attributes = Record<string, string | number | boolean | null | undefined>;
type Child = Node | string | null | undefined | false;

function fill(element: Element, attributes: Attributes, children: Child[]): void {
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    element.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child);
  }
}

/** HTML element builder: h('div', { class: 'card' }, 'text', child). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Attributes = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  fill(element, attributes, children);
  return element;
}

/** SVG element builder. */
export function s<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Attributes = {}, ...children: Child[]): SVGElementTagNameMap[K] {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  fill(element, attributes, children);
  return element;
}

/** Sets aria-pressed on the buttons of a segmented control and calls back on a change. */
export function segmented(group: Element, onChange: (value: string) => void): (value: string) => void {
  const buttons = () => [...group.querySelectorAll<HTMLButtonElement>('button[data-value]')];
  const set = (value: string) => buttons().forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === value)));
  group.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-value]');
    if (!button || button.disabled || button.getAttribute('aria-pressed') === 'true') return;
    set(button.dataset.value ?? '');
    onChange(button.dataset.value ?? '');
  });
  return set;
}

/** Shows one of several texts in place while keeping the room of the longest, so nothing below moves when the
 * text changes. The texts are written once; later calls only switch which one is visible. */
export function stackedText(element: HTMLElement | null | undefined, texts: Record<string, string>, active: string): void {
  if (!element) return;
  if (element.dataset.stacked !== Object.keys(texts).join('|')) {
    element.classList.add('stack');
    element.replaceChildren(...Object.entries(texts).map(([key, text]) => h('span', { 'data-key': key }, text)));
    element.dataset.stacked = Object.keys(texts).join('|');
  }
  element.querySelectorAll<HTMLElement>(':scope > [data-key]').forEach((span) => {
    const on = span.dataset.key === active;
    span.classList.toggle('on', on);
    span.setAttribute('aria-hidden', String(!on));
  });
}

/** Counts a number up to its final value inside the element (no animation with reduced motion). */
export function countUp(element: HTMLElement, target: number, format: (n: number) => string, duration = 900): void {
  if (reducedMotion()) { element.textContent = format(target); return; }
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    element.textContent = format(target * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export { seededRandom } from '../../lib/process/random';
