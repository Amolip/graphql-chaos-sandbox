import {
  Component,
  input,
  output,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TrafficSpikeReport } from '../../models/sandbox.models';

@Component({
  selector: 'app-traffic-spike-svg',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (report(); as rep) {
      <div class="spike-shell">
        <div class="spike-controls-bar">
          <div class="control-group">
            <label>
              Concurrent Virtual Clients:
              <strong>{{ concurrency() }} VUs</strong>
            </label>
            <input
              type="range"
              min="5"
              max="120"
              step="5"
              [value]="concurrency()"
              (input)="onConcurrencyChange($event)"
            />
          </div>

          <div class="control-group">
            <label>
              Burst Total Requests:
              <strong>{{ totalRequests() }} reqs</strong>
            </label>
            <input
              type="range"
              min="20"
              max="200"
              step="10"
              [value]="totalRequests()"
              (input)="onTotalRequestsChange($event)"
            />
          </div>

          <button
            type="button"
            class="fire-btn"
            (click)="triggerSpike.emit()"
          >
            ⚡ Fire Traffic Spike Wave
          </button>
        </div>

        <!-- KPI Percentile Cards -->
        <div class="spike-kpi-row">
          <div class="kpi-box">
            <span class="kpi-label">P50 Median Latency</span>
            <span class="kpi-val">{{ rep.metrics.p50Ms }}ms</span>
          </div>
          <div class="kpi-box warn">
            <span class="kpi-label">P95 Tail Latency</span>
            <span class="kpi-val">{{ rep.metrics.p95Ms }}ms</span>
          </div>
          <div class="kpi-box crit">
            <span class="kpi-label">P99 Extreme Tail</span>
            <span class="kpi-val">{{ rep.metrics.p99Ms }}ms</span>
          </div>
          <div class="kpi-box">
            <span class="kpi-label">Sustained Throughput</span>
            <span class="kpi-val cyan">{{ rep.metrics.rpsThroughput }} req/s</span>
          </div>
          <div class="kpi-box">
            <span class="kpi-label">Total SQL Queries Fired</span>
            <span class="kpi-val">{{ rep.metrics.totalDbQueries }}</span>
          </div>
          <div class="kpi-box">
            <span class="kpi-label">DB Pool Saturation</span>
            <span
              class="kpi-val"
              [class.crit-text]="rep.metrics.dbPoolSaturationPct > 75"
            >
              {{ rep.metrics.dbPoolSaturationPct }}%
            </span>
          </div>
        </div>

        <!-- SVG Latency Distribution & Burst Telemetry Chart -->
        <div class="spike-svg-box">
          <svg viewBox="0 0 920 230" class="spike-svg">
            <!-- Horizontal P95 / P50 Reference Lines -->
            <line
              x1="45"
              [attr.y1]="p95Y()"
              x2="900"
              [attr.y2]="p95Y()"
              stroke="#f59e0b"
              stroke-dasharray="4,4"
              stroke-width="1.2"
            />
            <text
              x="895"
              [attr.y]="p95Y() - 5"
              text-anchor="end"
              fill="#fbbf24"
              font-size="10"
              font-family="JetBrains Mono, monospace"
            >
              P95 ({{ rep.metrics.p95Ms }}ms)
            </text>

            <line
              x1="45"
              [attr.y1]="p50Y()"
              x2="900"
              [attr.y2]="p50Y()"
              stroke="#14b8a6"
              stroke-dasharray="3,3"
              stroke-width="1"
            />
            <text
              x="895"
              [attr.y]="p50Y() - 5"
              text-anchor="end"
              fill="#2dd4bf"
              font-size="10"
              font-family="JetBrains Mono, monospace"
            >
              P50 ({{ rep.metrics.p50Ms }}ms)
            </text>

            <!-- Request Bars -->
            @for (bar of chartBars(); track bar.index) {
              <g>
                <rect
                  [attr.x]="bar.x"
                  [attr.y]="bar.y"
                  [attr.width]="bar.w"
                  [attr.height]="bar.h"
                  [attr.fill]="bar.color"
                  rx="2"
                >
                  <title>
                    Req #{{ bar.index }}: {{ bar.durationMs }}ms ({{
                      bar.status
                    }}) — {{ bar.dbQueries }} DB queries
                  </title>
                </rect>
              </g>
            }
          </svg>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .spike-shell {
        background: #0b1120;
        border: 1px solid rgba(56, 189, 248, 0.18);
        border-radius: 10px;
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .spike-controls-bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        background: #0f172a;
        padding: 10px 14px;
        border-radius: 8px;
        border: 1px solid #1e293b;
      }
      .control-group {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 12px;
        color: #cbd5e1;
        min-width: 220px;
      }
      .control-group strong {
        color: #38bdf8;
        font-family: 'JetBrains Mono', monospace;
      }
      .fire-btn {
        background: linear-gradient(135deg, #0284c7, #2563eb);
        color: #fff;
        border: none;
        padding: 9px 16px;
        border-radius: 6px;
        font-weight: 700;
        font-size: 12.5px;
        cursor: pointer;
      }
      .spike-kpi-row {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(135px, 1fr));
        gap: 10px;
      }
      .kpi-box {
        background: #0f172a;
        border: 1px solid #1e293b;
        border-radius: 8px;
        padding: 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .kpi-label {
        font-size: 11px;
        color: #94a3b8;
      }
      .kpi-val {
        font-size: 18px;
        font-weight: 800;
        color: #f8fafc;
        font-family: 'JetBrains Mono', monospace;
      }
      .kpi-val.cyan {
        color: #38bdf8;
      }
      .kpi-val.crit-text {
        color: #f87171;
      }
      .spike-svg-box {
        background: #070b14;
        border: 1px solid #1e293b;
        border-radius: 8px;
        padding: 8px;
      }
      .spike-svg {
        width: 100%;
        height: 220px;
        display: block;
      }
    `,
  ],
})
export class TrafficSpikeSvgComponent {
  readonly report = input.required<TrafficSpikeReport | null>();
  readonly concurrency = input<number>(35);
  readonly totalRequests = input<number>(80);
  readonly concurrencyChange = output<number>();
  readonly totalRequestsChange = output<number>();
  readonly triggerSpike = output<void>();

  readonly maxLatency = computed(() => {
    const rep = this.report();
    if (!rep || rep.buckets.length === 0) return 200;
    return Math.max(...rep.buckets.map((b) => b.durationMs), 100) * 1.12;
  });

  readonly p95Y = computed(() => {
    const rep = this.report();
    if (!rep) return 60;
    const ratio = rep.metrics.p95Ms / this.maxLatency();
    return Math.round(205 - ratio * 175);
  });

  readonly p50Y = computed(() => {
    const rep = this.report();
    if (!rep) return 130;
    const ratio = rep.metrics.p50Ms / this.maxLatency();
    return Math.round(205 - ratio * 175);
  });

  readonly chartBars = computed(() => {
    const rep = this.report();
    if (!rep) return [];
    const count = rep.buckets.length;
    const usableW = 850;
    const slotW = usableW / Math.max(1, count);
    const barW = Math.max(2.5, slotW - 2);
    const maxL = this.maxLatency();

    return rep.buckets.map((b, i) => {
      const h = Math.max(6, (b.durationMs / maxL) * 175);
      const x = Number((48 + i * slotW).toFixed(1));
      const y = Number((205 - h).toFixed(1));
      let color = rep.useDataLoader ? '#14b8a6' : '#f59e0b';
      if (b.status === '503_CHAOS') color = '#ef4444';
      else if (b.status === '206_PARTIAL') color = '#a855f7';

      return {
        index: b.requestIndex,
        x,
        y,
        w: Number(barW.toFixed(1)),
        h: Number(h.toFixed(1)),
        color,
        durationMs: b.durationMs,
        status: b.status,
        dbQueries: b.dbQueries,
      };
    });
  });

  onConcurrencyChange(e: Event) {
    const val = Number((e.target as HTMLInputElement).value);
    this.concurrencyChange.emit(val);
  }

  onTotalRequestsChange(e: Event) {
    const val = Number((e.target as HTMLInputElement).value);
    this.totalRequestsChange.emit(val);
  }
}
