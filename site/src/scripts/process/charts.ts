// ECharts for the process page: only the pieces in use, styled from the theme's tokens (the look of
// robot_testing's charts.js: quiet axes, white rounded tooltip, short animations). A chart is created the first
// time it scrolls into view and is rebuilt whenever the mode or the style changes.
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, MarkLineComponent, MarkPointComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { alpha, color, onTheme, reducedMotion, token, whenVisible } from './core';

echarts.use([BarChart, LineChart, GridComponent, MarkLineComponent, MarkPointComponent, TooltipComponent, CanvasRenderer]);

export type Option = Record<string, unknown>;

export const fontFamily = (): string => token('--font') || 'sans-serif';

/** Options shared by every chart. */
export function base(extra: Option = {}): Option {
  const family = fontFamily();
  return {
    animation: !reducedMotion(),
    animationDuration: 500,
    animationDurationUpdate: 250,
    textStyle: { fontFamily: family, fontWeight: 500, color: color('--ink-2') },
    grid: { left: 54, right: 18, top: 18, bottom: 44 },
    tooltip: {
      trigger: 'axis', confine: true, backgroundColor: color('--surface'), borderColor: color('--line'), borderWidth: 1, padding: [10, 13],
      textStyle: { fontFamily: family, color: color('--ink'), fontSize: 13, fontWeight: 500 },
      extraCssText: 'border-radius:12px;box-shadow:0 8px 24px rgba(27,33,64,.10);',
      axisPointer: { type: 'line', lineStyle: { color: color('--line-strong'), type: 'dashed' }, shadowStyle: { color: alpha('--ink', 0.05) } },
    },
    ...extra,
  };
}

/** A value or category axis in the theme's look. */
export function axis(type: 'value' | 'category' | 'log', name = '', extra: Option = {}): Option {
  const family = fontFamily();
  return {
    type, name, nameLocation: 'middle', nameGap: 30,
    nameTextStyle: { fontFamily: family, fontWeight: 600, color: color('--ink-2'), fontSize: 12.5 },
    axisLine: { show: true, lineStyle: { color: color('--line-strong') } },
    axisTick: { show: false },
    axisLabel: { color: color('--ink-2'), fontFamily: family, fontWeight: 500, fontSize: 12, hideOverlap: true },
    splitLine: { show: type !== 'category', lineStyle: { color: color('--line') } },
    ...extra,
  };
}

export interface Mounted {
  /** Builds the option again and applies it (after a control changed what the chart shows). */
  refresh(): void;
}

/** Creates the chart when its element scrolls into view; build() is called again on every theme change. */
export function mount(element: HTMLElement, build: () => Option): Mounted {
  let chart: echarts.ECharts | null = null;
  const draw = (replace: boolean) => chart?.setOption(build(), replace);
  whenVisible(element, () => {
    chart = echarts.init(element);
    draw(true);
    new ResizeObserver(() => chart?.resize()).observe(element);
  });
  onTheme(() => draw(true));
  return { refresh: () => draw(false) };
}
