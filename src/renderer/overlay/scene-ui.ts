// Declarative Shadcn-style Interactive UI Harness renderer (kind: 'ui').
// Model output is strictly validated data (SceneUI); rendered via safe DOM/SVG APIs.
// Clicking any widget (or chart bar / table row) feeds PickedItem back into the conversation.
import type { Scene, SceneUI, SceneUIWidget, UIChartPoint } from '../../shared/scene';
import type { PickedItem, SceneRenderer, SelectHandler } from './scene-types';

const SVG_NS = 'http://www.w3.org/2000/svg';

export class SceneUIRenderer implements SceneRenderer {
  private root: HTMLElement;
  private grid: HTMLElement;
  private scene: SceneUI;
  private selectedId: string | null = null;
  private highlightedIds = new Set<string>();
  private widgetEls = new Map<string, HTMLElement>();

  constructor(
    private readonly host: HTMLElement,
    scene: SceneUI,
    private readonly onSelect: SelectHandler,
  ) {
    this.scene = scene;
    this.root = document.createElement('div');
    this.root.className = 'scene-ui-root';
    this.grid = document.createElement('div');
    this.root.appendChild(this.grid);
    this.host.replaceChildren(this.root);
    this.render();
  }

  update(next: Scene): void {
    if (next.kind !== 'ui') return;
    const scrollTop = this.root.scrollTop;
    this.scene = next;
    this.render();
    this.root.scrollTop = scrollTop;
  }

  highlight(ids: string[]): void {
    this.highlightedIds = new Set(ids);
    this.root.classList.toggle('focusing', ids.length > 0);
    for (const [id, el] of this.widgetEls) {
      el.classList.toggle('lit', this.highlightedIds.has(id));
    }
    if (ids.length > 0) {
      const first = this.widgetEls.get(ids[0]!);
      first?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  select(id: string | null): void {
    this.selectedId = id;
    for (const [wid, el] of this.widgetEls) {
      el.classList.toggle('selected', wid === id);
    }
  }

  resize(): void {
    // Responsive CSS grid handles layout sizing automatically
  }

  destroy(): void {
    this.widgetEls.clear();
    this.root.remove();
  }

  private pickWidget(w: SceneUIWidget, extraDetail?: string): void {
    const nextId = this.selectedId === w.id && !extraDetail ? null : w.id;
    this.select(nextId);
    if (!nextId) {
      this.onSelect(null);
      return;
    }
    const item: PickedItem = {
      itemId: w.id,
      label: w.label,
      detail: extraDetail ? `${w.detail} (${extraDetail})` : w.detail,
    };
    this.onSelect(item);
  }

  private render(): void {
    this.widgetEls.clear();
    this.root.replaceChildren();

    if (this.scene.subtitle) {
      const sub = document.createElement('div');
      sub.className = 'ui-scene-subtitle';
      sub.textContent = this.scene.subtitle;
      this.root.appendChild(sub);
    }

    this.grid = document.createElement('div');
    this.grid.className = `scene-ui-grid layout-${this.scene.layout}`;
    this.root.appendChild(this.grid);

    this.scene.widgets.forEach((w, index) => {
      const card = document.createElement('article');
      card.className = `ui-widget kind-${w.kind} tone-${w.tone} span-${w.span}`;
      card.style.setProperty('--i', String(index));
      card.tabIndex = 0;
      card.setAttribute('role', 'region');
      card.setAttribute('aria-label', w.label);
      if (this.selectedId === w.id) card.classList.add('selected');
      if (this.highlightedIds.has(w.id)) card.classList.add('lit');

      card.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('button, input, a, th')) return;
        this.pickWidget(w);
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'BUTTON') return;
          e.preventDefault();
          this.pickWidget(w);
        }
      });

      this.buildWidgetContent(card, w);
      this.widgetEls.set(w.id, card);
      this.grid.appendChild(card);
    });
  }

  private buildWidgetContent(card: HTMLElement, w: SceneUIWidget): void {
    // Header
    const head = document.createElement('header');
    head.className = 'ui-widget-head';

    const title = document.createElement('h4');
    title.className = 'ui-widget-title';
    title.textContent = w.label;
    head.appendChild(title);

    if (w.badge) {
      const badge = document.createElement('span');
      badge.className = `ui-badge tone-${w.tone}`;
      badge.textContent = w.badge;
      head.appendChild(badge);
    }
    card.appendChild(head);

    switch (w.kind) {
      case 'metric':
        this.renderMetric(card, w);
        break;
      case 'chart':
        this.renderChart(card, w);
        break;
      case 'table':
        this.renderTable(card, w);
        break;
      case 'code':
        this.renderCode(card, w);
        break;
      case 'checklist':
        this.renderChecklist(card, w);
        break;
      case 'slider':
        this.renderSlider(card, w);
        break;
      case 'comparison':
        this.renderComparison(card, w);
        break;
      case 'callout':
      case 'card':
      default:
        this.renderCard(card, w);
        break;
    }
  }

  private renderMetric(card: HTMLElement, w: SceneUIWidget): void {
    const valRow = document.createElement('div');
    valRow.className = 'ui-metric-row';

    const val = document.createElement('span');
    val.className = 'ui-metric-value';
    val.textContent = w.value ?? '—';
    valRow.appendChild(val);

    if (w.delta) {
      const delta = document.createElement('span');
      const trend = w.trend ?? (w.delta.startsWith('+') ? 'up' : w.delta.startsWith('-') ? 'down' : 'neutral');
      delta.className = `ui-metric-delta trend-${trend}`;
      const arrow = trend === 'up' ? '↑ ' : trend === 'down' ? '↓ ' : '';
      delta.textContent = `${arrow}${w.delta}`;
      valRow.appendChild(delta);
    }
    card.appendChild(valRow);

    if (typeof w.progress === 'number') {
      const track = document.createElement('div');
      track.className = 'ui-progress-track';
      const fill = document.createElement('div');
      fill.className = `ui-progress-fill tone-${w.tone}`;
      fill.style.width = `${Math.max(0, Math.min(100, w.progress))}%`;
      track.appendChild(fill);
      card.appendChild(track);
    }

    if (w.body) {
      const sub = document.createElement('p');
      sub.className = 'ui-widget-sub';
      sub.textContent = w.body;
      card.appendChild(sub);
    }
  }

  private renderChart(card: HTMLElement, w: SceneUIWidget): void {
    const series = w.series ?? [];
    if (!series.length) return;
    const unit = w.unit ? ` ${w.unit}` : '';
    const chartType = w.chartType ?? 'bar';

    if (chartType === 'donut') {
      const wrap = document.createElement('div');
      wrap.className = 'ui-donut-wrap';

      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('viewBox', '0 0 120 120');
      svg.setAttribute('class', 'ui-donut-svg');

      const total = Math.max(0.0001, series.reduce((acc, s) => acc + Math.max(0, s.value), 0));
      let accum = 0;
      const r = 42;
      const c = 2 * Math.PI * r;

      series.forEach((pt) => {
        const frac = Math.max(0, pt.value) / total;
        const dash = frac * c;
        const circle = document.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('cx', '60');
        circle.setAttribute('cy', '60');
        circle.setAttribute('r', String(r));
        circle.setAttribute('fill', 'none');
        circle.setAttribute('stroke', pt.color ?? '#3b82f6');
        circle.setAttribute('stroke-width', '16');
        circle.setAttribute('stroke-dasharray', `${dash} ${c - dash}`);
        circle.setAttribute('stroke-dashoffset', String(-accum * c));
        circle.style.cursor = 'pointer';
        circle.addEventListener('click', (e) => {
          e.stopPropagation();
          this.pickWidget(w, `${pt.label}: ${pt.value}${unit} (${Math.round(frac * 100)}%)`);
        });
        svg.appendChild(circle);
        accum += frac;
      });

      const legend = document.createElement('div');
      legend.className = 'ui-donut-legend';
      series.forEach((pt) => {
        const item = document.createElement('div');
        item.className = 'ui-legend-item';
        const dot = document.createElement('span');
        dot.className = 'ui-legend-dot';
        dot.style.background = pt.color ?? '#3b82f6';
        const lbl = document.createElement('span');
        lbl.className = 'ui-legend-label';
        lbl.textContent = pt.label;
        const v = document.createElement('span');
        v.className = 'ui-legend-val';
        v.textContent = `${pt.value}${unit}`;
        item.append(dot, lbl, v);
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          this.pickWidget(w, `${pt.label}: ${pt.value}${unit}`);
        });
        legend.appendChild(item);
      });

      wrap.append(svg, legend);
      card.appendChild(wrap);
      return;
    }

    if (chartType === 'line') {
      this.renderLineChart(card, w, series, unit);
      return;
    }

    // Default: Shadcn horizontal/vertical bar chart
    const maxVal = Math.max(1, ...series.map((s) => Math.abs(s.value)));
    const bars = document.createElement('div');
    bars.className = 'ui-bar-list';

    series.forEach((pt) => {
      const row = document.createElement('div');
      row.className = 'ui-bar-row';
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        this.pickWidget(w, `${pt.label}: ${pt.value}${unit}`);
      });

      const meta = document.createElement('div');
      meta.className = 'ui-bar-meta';
      const lbl = document.createElement('span');
      lbl.className = 'ui-bar-label';
      lbl.textContent = pt.label;
      const val = document.createElement('span');
      val.className = 'ui-bar-val';
      val.textContent = `${pt.value}${unit}`;
      meta.append(lbl, val);

      const track = document.createElement('div');
      track.className = 'ui-bar-track';
      const fill = document.createElement('div');
      fill.className = 'ui-bar-fill';
      fill.style.width = `${Math.round((Math.abs(pt.value) / maxVal) * 100)}%`;
      if (pt.color) fill.style.background = pt.color;
      track.appendChild(fill);

      row.append(meta, track);
      bars.appendChild(row);
    });

    card.appendChild(bars);
  }

  private renderLineChart(card: HTMLElement, w: SceneUIWidget, series: UIChartPoint[], unit: string): void {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 360 130');
    svg.setAttribute('class', 'ui-line-svg');

    const vals = series.map((s) => s.value);
    const minV = Math.min(0, ...vals);
    const maxV = Math.max(minV + 1, ...vals);
    const padX = 24;
    const padY = 18;
    const W = 360 - padX * 2;
    const H = 130 - padY * 2 - 14;

    const pts = series.map((s, i) => {
      const x = padX + (series.length > 1 ? (i / (series.length - 1)) * W : W / 2);
      const y = padY + H - ((s.value - minV) / (maxV - minV)) * H;
      return { x, y, s };
    });

    if (pts.length > 1) {
      const areaD = `M ${pts[0]!.x} ${padY + H} ` + pts.map((p) => `L ${p.x} ${p.y}`).join(' ') + ` L ${pts[pts.length - 1]!.x} ${padY + H} Z`;
      const area = document.createElementNS(SVG_NS, 'path');
      area.setAttribute('d', areaD);
      area.setAttribute('fill', 'rgba(59, 130, 246, 0.16)');
      svg.appendChild(area);

      const lineD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', lineD);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', '#3b82f6');
      path.setAttribute('stroke-width', '2.5');
      path.setAttribute('stroke-linecap', 'round');
      svg.appendChild(path);
    }

    pts.forEach((p) => {
      const g = document.createElementNS(SVG_NS, 'g');
      g.style.cursor = 'pointer';
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', String(p.x));
      dot.setAttribute('cy', String(p.y));
      dot.setAttribute('r', '4');
      dot.setAttribute('fill', p.s.color ?? '#60a5fa');
      dot.setAttribute('stroke', '#09090b');
      dot.setAttribute('stroke-width', '1.5');

      const txt = document.createElementNS(SVG_NS, 'text');
      txt.setAttribute('x', String(p.x));
      txt.setAttribute('y', String(124));
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('fill', '#94a3b8');
      txt.setAttribute('font-size', '9.5');
      txt.textContent = p.s.label.slice(0, 8);

      g.append(dot, txt);
      g.addEventListener('click', (e) => {
        e.stopPropagation();
        this.pickWidget(w, `${p.s.label}: ${p.s.value}${unit}`);
      });
      svg.appendChild(g);
    });

    card.appendChild(svg);
  }

  private renderTable(card: HTMLElement, w: SceneUIWidget): void {
    const cols = w.columns ?? [];
    const rows = [...(w.rows ?? [])];
    if (!cols.length) return;

    const wrap = document.createElement('div');
    wrap.className = 'ui-table-wrap';
    const table = document.createElement('table');
    table.className = 'ui-table';

    let sortCol = -1;
    let sortAsc = true;

    const thead = document.createElement('thead');
    const trHead = document.createElement('tr');
    cols.forEach((c, idx) => {
      const th = document.createElement('th');
      th.textContent = c;
      th.title = 'Click to sort';
      th.addEventListener('click', (e) => {
        e.stopPropagation();
        if (sortCol === idx) sortAsc = !sortAsc;
        else {
          sortCol = idx;
          sortAsc = true;
        }
        rows.sort((a, b) => {
          const av = a[idx] ?? '';
          const bv = b[idx] ?? '';
          const an = Number(av.replace(/[^0-9.-]/g, ''));
          const bn = Number(bv.replace(/[^0-9.-]/g, ''));
          if (!Number.isNaN(an) && !Number.isNaN(bn) && av.trim() !== '' && bv.trim() !== '') {
            return sortAsc ? an - bn : bn - an;
          }
          return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
        });
        renderBody();
      });
      trHead.appendChild(th);
    });
    thead.appendChild(trHead);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const renderBody = () => {
      tbody.replaceChildren();
      rows.forEach((r) => {
        const tr = document.createElement('tr');
        r.forEach((cell) => {
          const td = document.createElement('td');
          td.textContent = cell;
          tr.appendChild(td);
        });
        tr.addEventListener('click', (e) => {
          e.stopPropagation();
          this.pickWidget(w, `Row: ${r.join(' · ')}`);
        });
        tbody.appendChild(tr);
      });
    };
    renderBody();
    table.appendChild(tbody);
    wrap.appendChild(table);
    card.appendChild(wrap);
  }

  private renderCode(card: HTMLElement, w: SceneUIWidget): void {
    const bar = document.createElement('div');
    bar.className = 'ui-code-bar';
    const lang = document.createElement('span');
    lang.className = 'ui-code-lang';
    lang.textContent = w.language || 'code';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'ui-copy-btn';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void navigator.clipboard?.writeText(w.code ?? '');
      copyBtn.textContent = 'Copied!';
      setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
    });

    bar.append(lang, copyBtn);
    const pre = document.createElement('pre');
    pre.className = 'ui-code-pre';
    const code = document.createElement('code');
    code.textContent = w.code ?? '';
    pre.appendChild(code);
    card.append(bar, pre);
  }

  private renderChecklist(card: HTMLElement, w: SceneUIWidget): void {
    const items = w.items ?? [];
    const list = document.createElement('div');
    list.className = 'ui-checklist';

    items.forEach((it) => {
      const label = document.createElement('label');
      label.className = 'ui-check-row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!it.checked;
      const text = document.createElement('span');
      text.className = 'ui-check-label';
      text.textContent = it.label;
      if (it.value) {
        const sub = document.createElement('span');
        sub.className = 'ui-check-sub';
        sub.textContent = it.value;
        label.append(box, text, sub);
      } else {
        label.append(box, text);
      }
      box.addEventListener('change', () => {
        it.checked = box.checked;
        this.pickWidget(w, `${it.label}: ${box.checked ? 'checked' : 'unchecked'}`);
      });
      list.appendChild(label);
    });
    card.appendChild(list);
  }

  private renderSlider(card: HTMLElement, w: SceneUIWidget): void {
    const min = w.min ?? 0;
    const max = w.max ?? 100;
    const step = w.step ?? 1;
    const initial = w.initial ?? 50;
    const mult = w.multiplier ?? 1;
    const unit = w.unit ? ` ${w.unit}` : '';

    const wrap = document.createElement('div');
    wrap.className = 'ui-slider-wrap';

    const readout = document.createElement('div');
    readout.className = 'ui-slider-readout';
    const inputVal = document.createElement('span');
    inputVal.className = 'ui-slider-in';
    const outputVal = document.createElement('span');
    outputVal.className = 'ui-slider-out';

    const updateReadout = (v: number) => {
      const computed = Math.round(v * mult * 100) / 100;
      inputVal.textContent = `Input: ${v}`;
      outputVal.textContent = `${w.formulaLabel || 'Output'}: ${computed}${unit}`;
    };
    updateReadout(initial);
    readout.append(inputVal, outputVal);

    const range = document.createElement('input');
    range.type = 'range';
    range.className = 'ui-slider-input';
    range.min = String(min);
    range.max = String(max);
    range.step = String(step);
    range.value = String(initial);
    range.addEventListener('input', () => {
      const v = Number(range.value);
      updateReadout(v);
      const computed = Math.round(v * mult * 100) / 100;
      this.pickWidget(w, `Set to ${v} → ${w.formulaLabel || 'Output'}: ${computed}${unit}`);
    });

    wrap.append(readout, range);
    if (w.body) {
      const p = document.createElement('p');
      p.className = 'ui-widget-sub';
      p.textContent = w.body;
      wrap.appendChild(p);
    }
    card.appendChild(wrap);
  }

  private renderComparison(card: HTMLElement, w: SceneUIWidget): void {
    const items = w.items ?? [];
    const table = document.createElement('div');
    table.className = 'ui-comparison';

    if (w.leftTitle || w.rightTitle) {
      const head = document.createElement('div');
      head.className = 'ui-comp-head';
      const f = document.createElement('span');
      f.textContent = 'Aspect';
      const l = document.createElement('span');
      l.textContent = w.leftTitle || 'Option A';
      const r = document.createElement('span');
      r.textContent = w.rightTitle || 'Option B';
      head.append(f, l, r);
      table.appendChild(head);
    }

    items.forEach((it) => {
      const row = document.createElement('div');
      row.className = 'ui-comp-row';
      const k = document.createElement('span');
      k.className = 'ui-comp-key';
      k.textContent = it.label;
      const v1 = document.createElement('span');
      v1.className = 'ui-comp-v1';
      v1.textContent = it.value;
      const v2 = document.createElement('span');
      v2.className = 'ui-comp-v2';
      v2.textContent = it.rightValue ?? '—';
      row.append(k, v1, v2);
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        this.pickWidget(w, `${it.label}: ${it.value} vs ${it.rightValue ?? '—'}`);
      });
      table.appendChild(row);
    });

    card.appendChild(table);
  }

  private renderCard(card: HTMLElement, w: SceneUIWidget): void {
    if (w.body) {
      const body = document.createElement('p');
      body.className = 'ui-card-body';
      body.textContent = w.body;
      card.appendChild(body);
    }
    if (w.items && w.items.length > 0) {
      const list = document.createElement('div');
      list.className = 'ui-kv-list';
      w.items.forEach((it) => {
        const row = document.createElement('div');
        row.className = 'ui-kv-row';
        const k = document.createElement('span');
        k.className = 'ui-kv-key';
        k.textContent = it.label;
        const v = document.createElement('span');
        v.className = `ui-kv-val tone-${it.tone ?? 'default'}`;
        v.textContent = it.value;
        row.append(k, v);
        list.appendChild(row);
      });
      card.appendChild(list);
    }
  }
}

