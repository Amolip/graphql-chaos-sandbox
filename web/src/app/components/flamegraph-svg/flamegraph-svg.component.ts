import {
  Component,
  input,
  output,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ResolverTraceSpan } from '../../models/sandbox.models';

interface FlameRect {
  span: ResolverTraceSpan;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  label: string;
}

@Component({
  selector: 'app-flamegraph-svg',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flame-shell">
      <div class="flame-toolbar">
        <div class="flame-modes">
          <button
            type="button"
            class="mode-btn"
            [class.active]="viewMode() === 'WATERFALL'"
            (click)="viewMode.set('WATERFALL')"
          >
            Resolver Execution Waterfall ({{ traces().length }} spans)
          </button>
          <button
            type="button"
            class="mode-btn"
            [class.active]="viewMode() === 'ICICLE'"
            (click)="viewMode.set('ICICLE')"
          >
            Depth Stack Flamegraph
          </button>
        </div>

        <div class="flame-filter">
          <input
            type="text"
            placeholder="Filter span path (e.g. reviews, seller, orders.0)..."
            [value]="searchFilter()"
            (input)="onSearch($event)"
          />
          <span class="zoom-controls">
            <button type="button" (click)="zoomOut()" title="Zoom Out">−</button>
            <span class="zoom-val">{{ (zoomLevel() * 100).toFixed(0) }}%</span>
            <button type="button" (click)="zoomIn()" title="Zoom In">+</button>
          </span>
        </div>

        <div class="flame-legend">
          <span class="legend-chip ok"><i class="dot"></i>Batched / Fast (&lt;15ms)</span>
          <span class="legend-chip nplus"><i class="dot"></i>Unbatched N+1 SQL Hit</span>
          <span class="legend-chip chaos"><i class="dot"></i>Chaos Latency / Jitter</span>
          <span class="legend-chip err"><i class="dot"></i>Injected Partial Failure</span>
        </div>
      </div>

      <div class="svg-viewport">
        <svg
          [attr.viewBox]="'0 0 ' + svgWidth() + ' ' + svgHeight()"
          [style.width.px]="svgWidth() * zoomLevel()"
          [style.height.px]="svgHeight()"
          class="flame-svg"
        >
          <defs>
            <linearGradient id="gradFast" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="#0d9488" />
              <stop offset="100%" stop-color="#14b8a6" />
            </linearGradient>
            <linearGradient id="gradNPlus" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="#d97706" />
              <stop offset="100%" stop-color="#f59e0b" />
            </linearGradient>
            <linearGradient id="gradChaos" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="#7c3aed" />
              <stop offset="100%" stop-color="#a855f7" />
            </linearGradient>
            <linearGradient id="gradError" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="#dc2626" />
              <stop offset="100%" stop-color="#ef4444" />
            </linearGradient>
          </defs>

          <!-- Timeline Axis Ticks -->
          @for (tick of timeTicks(); track tick.ms) {
            <g class="time-tick">
              <line
                [attr.x1]="tick.x"
                y1="24"
                [attr.x2]="tick.x"
                [attr.y2]="svgHeight()"
                stroke="rgba(148, 163, 184, 0.14)"
                stroke-dasharray="3,3"
              />
              <text
                [attr.x]="tick.x + 4"
                y="16"
                fill="#94a3b8"
                font-size="10"
                font-family="JetBrains Mono, monospace"
              >
                {{ tick.ms }}ms
              </text>
            </g>
          }

          <!-- Span Flame Rectangles -->
          @for (rect of flameRects(); track rect.span.id) {
            <g
              class="span-group"
              [class.selected]="selectedSpan()?.id === rect.span.id"
              (click)="selectSpan(rect.span)"
              (mouseenter)="hoveredSpan.set(rect.span)"
              (mouseleave)="hoveredSpan.set(null)"
            >
              <!-- Row subtle guide in Waterfall mode -->
              @if (viewMode() === 'WATERFALL') {
                <rect
                  x="0"
                  [attr.y]="rect.y - 1"
                  [attr.width]="svgWidth()"
                  [attr.height]="rect.height + 2"
                  fill="rgba(15, 23, 42, 0.28)"
                />
                <text
                  x="8"
                  [attr.y]="rect.y + 14"
                  fill="#cbd5e1"
                  font-size="11"
                  font-family="JetBrains Mono, monospace"
                >
                  {{ rect.span.path }}
                </text>
              }

              <!-- Actual Execution Bar -->
              <rect
                [attr.x]="rect.x"
                [attr.y]="rect.y"
                [attr.width]="rect.width"
                [attr.height]="rect.height"
                [attr.fill]="rect.fill"
                [attr.stroke]="
                  selectedSpan()?.id === rect.span.id ? '#38bdf8' : rect.stroke
                "
                [attr.stroke-width]="
                  selectedSpan()?.id === rect.span.id ? '2' : '1'
                "
                rx="3"
              />

              <!-- Bar Label -->
              @if (rect.width > 42) {
                <text
                  [attr.x]="rect.x + 6"
                  [attr.y]="rect.y + 14"
                  fill="#f8fafc"
                  font-size="10.5"
                  font-weight="600"
                  font-family="JetBrains Mono, monospace"
                  class="bar-text"
                >
                  {{ rect.label }}
                </text>
              }
            </g>
          }
        </svg>
      </div>

      <!-- Active Span Telemetry Footer -->
      @if (activeInspectorSpan(); as span) {
        <div class="span-inspector">
          <div class="inspector-main">
            <span class="span-badge" [attr.data-status]="span.status">
              {{ span.status }}
            </span>
            <code class="span-path">{{ span.path }}</code>
            <span class="span-type"
              >{{ span.parentType }}.{{ span.fieldName }} →
              {{ span.returnType }}</span
            >
          </div>
          <div class="inspector-metrics">
            <span>
              <strong>Start:</strong> +{{ span.startOffsetMs }}ms
            </span>
            <span>
              <strong>Duration:</strong> {{ span.durationMs }}ms
            </span>
            <span>
              <strong>Batch Mode:</strong>
              {{
                span.batchedWithDataLoader
                  ? 'DataLoader Coalesced (O(1))'
                  : 'Unbatched N+1 SQL Roundtrip'
              }}
            </span>
            @if (span.chaosInjected) {
              <span class="chaos-tag">
                ⚡ Chaos {{ span.chaosInjected.type }} (+{{
                  span.chaosInjected.addedLatencyMs
                }}ms)
              </span>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .flame-shell {
        display: flex;
        flex-direction: column;
        gap: 10px;
        background: #0b1120;
        border: 1px solid rgba(56, 189, 248, 0.18);
        border-radius: 10px;
        padding: 12px;
      }
      .flame-toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .flame-modes {
        display: flex;
        gap: 6px;
      }
      .mode-btn {
        background: #1e293b;
        color: #94a3b8;
        border: 1px solid #334155;
        padding: 6px 12px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .mode-btn.active {
        background: rgba(14, 165, 233, 0.18);
        color: #38bdf8;
        border-color: #0284c7;
      }
      .flame-filter {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .flame-filter input {
        background: #0f172a;
        border: 1px solid #334155;
        color: #e2e8f0;
        padding: 5px 10px;
        border-radius: 6px;
        font-size: 12px;
        width: 240px;
      }
      .zoom-controls {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: #1e293b;
        border-radius: 6px;
        padding: 2px 6px;
        font-size: 11px;
        color: #cbd5e1;
      }
      .zoom-controls button {
        background: transparent;
        border: none;
        color: #38bdf8;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
        padding: 0 4px;
      }
      .flame-legend {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        font-size: 11px;
        color: #94a3b8;
      }
      .legend-chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      .legend-chip .dot {
        width: 9px;
        height: 9px;
        border-radius: 2px;
        display: inline-block;
      }
      .legend-chip.ok .dot {
        background: #14b8a6;
      }
      .legend-chip.nplus .dot {
        background: #f59e0b;
      }
      .legend-chip.chaos .dot {
        background: #a855f7;
      }
      .legend-chip.err .dot {
        background: #ef4444;
      }
      .svg-viewport {
        overflow-x: auto;
        overflow-y: auto;
        max-height: 410px;
        border: 1px solid #1e293b;
        border-radius: 8px;
        background: #070b14;
      }
      .flame-svg {
        display: block;
      }
      .span-group {
        cursor: pointer;
      }
      .span-group:hover rect {
        filter: brightness(1.16);
      }
      .bar-text {
        pointer-events: none;
      }
      .span-inspector {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 12px;
        background: #0f172a;
        border: 1px solid #1e293b;
        border-radius: 6px;
        font-size: 12px;
      }
      .inspector-main {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .span-badge {
        padding: 2px 7px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 700;
        background: rgba(20, 184, 166, 0.2);
        color: #2dd4bf;
      }
      .span-badge[data-status='SLOW'] {
        background: rgba(245, 158, 11, 0.2);
        color: #fbbf24;
      }
      .span-badge[data-status='ERROR'] {
        background: rgba(239, 68, 68, 0.25);
        color: #f87171;
      }
      .span-path {
        color: #38bdf8;
        font-family: 'JetBrains Mono', monospace;
        font-weight: 600;
      }
      .span-type {
        color: #94a3b8;
      }
      .inspector-metrics {
        display: flex;
        flex-wrap: wrap;
        gap: 14px;
        color: #cbd5e1;
      }
      .chaos-tag {
        color: #c084fc;
        font-weight: 600;
      }
    `,
  ],
})
export class FlamegraphSvgComponent {
  readonly traces = input.required<ResolverTraceSpan[]>();
  readonly totalDurationMs = input<number>(100);
  readonly selectedSpan = input<ResolverTraceSpan | null>(null);
  readonly spanSelected = output<ResolverTraceSpan>();

  readonly viewMode = signal<'WATERFALL' | 'ICICLE'>('WATERFALL');
  readonly searchFilter = signal<string>('');
  readonly zoomLevel = signal<number>(1);
  readonly hoveredSpan = signal<ResolverTraceSpan | null>(null);

  readonly svgWidth = signal<number>(940);

  readonly filteredTraces = computed(() => {
    const q = this.searchFilter().trim().toLowerCase();
    const list = this.traces();
    if (!q) return list;
    return list.filter(
      (s) =>
        s.path.toLowerCase().includes(q) ||
        s.fieldName.toLowerCase().includes(q) ||
        s.parentType.toLowerCase().includes(q),
    );
  });

  readonly svgHeight = computed(() => {
    if (this.viewMode() === 'ICICLE') {
      return 240;
    }
    return Math.max(200, 34 + this.filteredTraces().length * 24);
  });

  readonly timeTicks = computed(() => {
    const maxMs = Math.max(this.totalDurationMs(), 10);
    const leftPad = this.viewMode() === 'WATERFALL' ? 235 : 24;
    const usableW = this.svgWidth() - leftPad - 24;
    const steps = 6;
    return Array.from({ length: steps + 1 }, (_, idx) => {
      const ratio = idx / steps;
      return {
        ms: Number((maxMs * ratio).toFixed(1)),
        x: Math.round(leftPad + usableW * ratio),
      };
    });
  });

  readonly flameRects = computed<FlameRect[]>(() => {
    const spans = this.filteredTraces();
    const maxMs = Math.max(this.totalDurationMs(), 10);
    const isWaterfall = this.viewMode() === 'WATERFALL';
    const leftPad = isWaterfall ? 235 : 24;
    const usableW = this.svgWidth() - leftPad - 24;

    return spans.map((span, idx) => {
      const x =
        leftPad + (span.startOffsetMs / maxMs) * usableW;
      const width = Math.max(
        8,
        (span.durationMs / maxMs) * usableW,
      );
      const row = isWaterfall ? idx : Math.max(0, span.depth - 1);
      const y = isWaterfall ? 30 + row * 24 : 34 + row * 38;
      const height = isWaterfall ? 19 : 30;

      let fill = 'url(#gradFast)';
      let stroke = '#0f766e';

      if (span.status === 'ERROR') {
        fill = 'url(#gradError)';
        stroke = '#b91c1c';
      } else if (span.chaosInjected) {
        fill = 'url(#gradChaos)';
        stroke = '#6d28d9';
      } else if (!span.batchedWithDataLoader && span.depth >= 2) {
        fill = 'url(#gradNPlus)';
        stroke = '#b45309';
      }

      return {
        span,
        row,
        x: Number(x.toFixed(1)),
        y,
        width: Number(width.toFixed(1)),
        height,
        fill,
        stroke,
        label: `${span.fieldName} (${span.durationMs}ms)`,
      };
    });
  });

  readonly activeInspectorSpan = computed(
    () => this.hoveredSpan() || this.selectedSpan() || this.traces()[0] || null,
  );

  onSearch(event: Event) {
    const target = event.target as HTMLInputElement;
    this.searchFilter.set(target.value);
  }

  zoomIn() {
    this.zoomLevel.update((z) => Math.min(2.5, Number((z + 0.25).toFixed(2))));
  }

  zoomOut() {
    this.zoomLevel.update((z) => Math.max(1, Number((z - 0.25).toFixed(2))));
  }

  selectSpan(span: ResolverTraceSpan) {
    this.spanSelected.emit(span);
  }
}
