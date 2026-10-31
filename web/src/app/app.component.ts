import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTabsModule } from '@angular/material/tabs';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonModule } from '@angular/material/button';
import {
  SandboxEngineService,
  QUERY_PRESETS,
} from './services/sandbox-engine.service';
import { FlamegraphSvgComponent } from './components/flamegraph-svg/flamegraph-svg.component';
import { DependencyTreeSvgComponent } from './components/dependency-tree-svg/dependency-tree-svg.component';
import { AstInspectorComponent } from './components/ast-inspector/ast-inspector.component';
import { TrafficSpikeSvgComponent } from './components/traffic-spike-svg/traffic-spike-svg.component';
import { ChaosConfig, QueryPreset } from './models/sandbox.models';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatTabsModule,
    MatSlideToggleModule,
    MatButtonModule,
    FlamegraphSvgComponent,
    DependencyTreeSvgComponent,
    AstInspectorComponent,
    TrafficSpikeSvgComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="devtools-shell">
      <!-- Top Telemetry Header -->
      <header class="top-bar">
        <div class="brand">
          <div class="logo-orb">GQL</div>
          <div>
            <h1>
              GraphQL Performance & Chaos Engineering Sandbox
              <span class="version-pill">Angular 22 Signals · Material · NestJS Apollo</span>
            </h1>
            <p class="subtitle">
              AST Complexity & Depth Gatekeeper · N+1 vs DataLoader Coalescing · Per-Resolver Flamegraphs · Fault Injection
            </p>
          </div>
        </div>

        <div class="endpoint-box">
          <span
            class="engine-status"
            [class.live]="engine.connectionMode() === 'LIVE_NESTJS'"
          >
            <i class="pulse"></i>
            {{
              engine.connectionMode() === 'LIVE_NESTJS'
                ? 'Connected: NestJS Apollo Plugin (:3333)'
                : 'In-Browser Deterministic AST + Chaos Engine'
            }}
          </span>

          <input
            type="text"
            class="endpoint-input"
            [ngModel]="engine.endpointUrl()"
            (ngModelChange)="engine.endpointUrl.set($event)"
            aria-label="GraphQL Endpoint URL"
          />

          <button
            type="button"
            class="exec-btn"
            [disabled]="engine.isExecuting()"
            (click)="runAll()"
          >
            ▶ Execute & Trace Query
          </button>
        </div>
      </header>

      <!-- Scenario Presets Strip -->
      <section class="preset-strip" aria-label="Scenario Presets">
        <span class="strip-label">SCENARIO PRESETS:</span>
        @for (preset of presets; track preset.id) {
          <button
            type="button"
            class="preset-chip"
            [class.active]="engine.activePresetId() === preset.id"
            (click)="selectPreset(preset)"
          >
            <span class="preset-badge">{{ preset.badge }}</span>
            <span>{{ preset.label }}</span>
          </button>
        }
      </section>

      <!-- Real-Time KPI Telemetry Strip -->
      <section class="kpi-strip">
        <div
          class="kpi-card"
          [class.danger]="
            engine.liveAstAnalysis().totalComplexityScore >
            engine.chaosConfig().maxComplexity
          "
        >
          <span class="k-title">STATIC AST COMPLEXITY</span>
          <div class="k-value">
            {{ engine.liveAstAnalysis().totalComplexityScore }}
            <small>/ {{ engine.chaosConfig().maxComplexity }} pts</small>
          </div>
          <span class="k-foot">
            Multipliers:
            {{
              engine.liveAstAnalysis().listMultiplierPaths.slice(0, 2).join(', ') ||
                '1x'
            }}
          </span>
        </div>

        <div
          class="kpi-card"
          [class.danger]="
            engine.liveAstAnalysis().maxDepth > engine.chaosConfig().maxDepth
          "
        >
          <span class="k-title">AST NESTING DEPTH</span>
          <div class="k-value">
            {{ engine.liveAstAnalysis().maxDepth }}
            <small>/ {{ engine.chaosConfig().maxDepth }} levels</small>
          </div>
          <span class="k-foot">
            {{ engine.liveAstAnalysis().totalFields }} AST Field Selection Nodes
          </span>
        </div>

        <div
          class="kpi-card"
          [class.warn]="!engine.chaosConfig().useDataLoader"
          [class.good]="engine.chaosConfig().useDataLoader"
        >
          <span class="k-title">SQL / RPC QUERIES FIRED</span>
          <div class="k-value">
            {{ engine.latestTelemetry()?.dbQueryCount ?? 0 }}
            <small>
              {{
                engine.chaosConfig().useDataLoader
                  ? 'Batched (DataLoader)'
                  : 'Unbatched (N+1)'
              }}
            </small>
          </div>
          <span class="k-foot">
            {{ engine.liveAstAnalysis().nPlusOneWarnings.length }} N+1 Fan-Out Hotspots
            in AST
          </span>
        </div>

        <div class="kpi-card">
          <span class="k-title">END-TO-END WATERFALL</span>
          <div class="k-value">
            {{ engine.latestTelemetry()?.totalDurationMs ?? 0 }}
            <small>ms</small>
          </div>
          <span class="k-foot">
            {{ engine.latestTelemetry()?.resolverWatermarkCount ?? 0 }} Traced
            Resolver Spans
          </span>
        </div>

        <div
          class="kpi-card"
          [class.chaos-active]="engine.chaosConfig().enabled"
        >
          <span class="k-title">CHAOS ENGINE FAULTS</span>
          <div class="k-value">
            {{ engine.latestTelemetry()?.chaosEventsTriggered ?? 0 }}
            <small>{{
              engine.chaosConfig().enabled ? engine.chaosConfig().mode : 'DISABLED'
            }}</small>
          </div>
          <span class="k-foot">
            DataLoader Batch Coalescing:
            <strong>{{
              engine.chaosConfig().useDataLoader ? 'ON (O(1))' : 'OFF (N+1)'
            }}</strong>
          </span>
        </div>
      </section>

      <!-- Main Workspace Grid -->
      <main class="workspace-grid">
        <!-- Left Column: GraphQL Query / SDL Editor + Chaos & DataLoader Controls -->
        <aside class="left-panel">
          <div class="editor-card">
            <div class="editor-tabs">
              <button
                type="button"
                [class.active]="leftEditorTab() === 'QUERY'"
                (click)="leftEditorTab.set('QUERY')"
              >
                GraphQL Operation AST
              </button>
              <button
                type="button"
                [class.active]="leftEditorTab() === 'SCHEMA'"
                (click)="leftEditorTab.set('SCHEMA')"
              >
                GraphQL Schema SDL
              </button>
              <button
                type="button"
                [class.active]="leftEditorTab() === 'RESPONSE'"
                (click)="leftEditorTab.set('RESPONSE')"
              >
                Extensions Payload
              </button>
            </div>

            @if (leftEditorTab() === 'QUERY') {
              <textarea
                class="code-editor"
                spellcheck="false"
                [ngModel]="engine.queryText()"
                (ngModelChange)="onQueryEdit($event)"
                aria-label="GraphQL Query Editor"
              ></textarea>
            } @else if (leftEditorTab() === 'SCHEMA') {
              <textarea
                class="code-editor"
                spellcheck="false"
                [ngModel]="engine.schemaSdl()"
                (ngModelChange)="engine.schemaSdl.set($event)"
                aria-label="GraphQL Schema SDL Editor"
              ></textarea>
            } @else {
              <pre class="code-editor json-preview">{{
                engine.latestResponseJson()
              }}</pre>
            }
          </div>

          <!-- Chaos & Batching Control Deck -->
          <div class="chaos-card">
            <div class="chaos-header">
              <h3>Chaos & Resolver Batching Controls</h3>
              <span class="badge-live">Apollo Plugin Hook</span>
            </div>

            <!-- DataLoader Switch -->
            <div class="toggle-box dataloader-box">
              <div>
                <strong>Request-Scoped DataLoader&lt;K, V&gt;</strong>
                <p>Coalesce N+1 child resolver queries into single event-loop tick batches</p>
              </div>
              <mat-slide-toggle
                [checked]="engine.chaosConfig().useDataLoader"
                (change)="engine.toggleDataLoader($event.checked)"
              >
              </mat-slide-toggle>
            </div>

            <!-- Chaos Enable Switch -->
            <div class="toggle-box">
              <div>
                <strong>Inject Chaos Monkey Faults</strong>
                <p>Simulate network jitter, latency spikes, or partial subgraph errors</p>
              </div>
              <mat-slide-toggle
                [checked]="engine.chaosConfig().enabled"
                (change)="onChaosToggle($event.checked)"
              >
              </mat-slide-toggle>
            </div>

            <div class="chaos-sliders">
              <label class="field-row">
                <span>Chaos Failure Mode</span>
                <select
                  [ngModel]="engine.chaosConfig().mode"
                  (ngModelChange)="onChaosModeChange($event)"
                >
                  <option value="NONE">NONE (Healthy Baseline)</option>
                  <option value="LATENCY_SPIKE">LATENCY_SPIKE (Fixed Delay)</option>
                  <option value="PACKET_JITTER">PACKET_JITTER (Random Tail Jitter)</option>
                  <option value="PARTIAL_FAILURE">PARTIAL_FAILURE (Subgraph 503 Errors)</option>
                  <option value="DB_POOL_EXHAUSTION">
                    DB_POOL_EXHAUSTION (N+1 Contention)
                  </option>
                </select>
              </label>

              <label class="field-row">
                <span>
                  Injected Resolver Latency:
                  <strong>{{ engine.chaosConfig().latencyMs }}ms</strong>
                </span>
                <input
                  type="range"
                  min="0"
                  max="200"
                  step="5"
                  [ngModel]="engine.chaosConfig().latencyMs"
                  (ngModelChange)="onLatencyChange($event)"
                />
              </label>

              <label class="field-row">
                <span>
                  Subgraph Partial Error Rate:
                  <strong>{{ (engine.chaosConfig().failureRate * 100).toFixed(0) }}%</strong>
                </span>
                <input
                  type="range"
                  min="0"
                  max="0.8"
                  step="0.05"
                  [ngModel]="engine.chaosConfig().failureRate"
                  (ngModelChange)="onFailureRateChange($event)"
                />
              </label>

              <div class="gate-limits">
                <label>
                  <span>Max Complexity Budget</span>
                  <input
                    type="number"
                    [ngModel]="engine.chaosConfig().maxComplexity"
                    (ngModelChange)="
                      engine.updateChaosPatch({ maxComplexity: +$event })
                    "
                  />
                </label>
                <label>
                  <span>Max AST Depth Limit</span>
                  <input
                    type="number"
                    [ngModel]="engine.chaosConfig().maxDepth"
                    (ngModelChange)="
                      engine.updateChaosPatch({ maxDepth: +$event })
                    "
                  />
                </label>
              </div>
            </div>
          </div>
        </aside>

        <!-- Right Column: Interactive Flamegraph, AST Stepper & Tree, Dependency Graph, Traffic Spike -->
        <section class="right-panel">
          <mat-tab-group animationDuration="150ms" class="sandbox-tabs">
            <mat-tab label="1. Resolver Waterfall & SVG Flamegraph">
              <div class="tab-pane">
                <app-flamegraph-svg
                  [traces]="engine.latestTelemetry()?.traces ?? []"
                  [totalDurationMs]="
                    engine.latestTelemetry()?.totalDurationMs ?? 100
                  "
                  [selectedSpan]="engine.selectedSpan()"
                  (spanSelected)="engine.selectedSpan.set($event)"
                />
              </div>
            </mat-tab>

            <mat-tab label="2. AST Stepper & Deep Material Tree">
              <div class="tab-pane">
                <app-ast-inspector
                  [analysis]="engine.liveAstAnalysis()"
                  [selectedNode]="engine.selectedAstNode()"
                  (nodeSelected)="engine.selectedAstNode.set($event)"
                />
              </div>
            </mat-tab>

            <mat-tab label="3. Interactive SVG Dependency Tree">
              <div class="tab-pane">
                <app-dependency-tree-svg
                  [astRoots]="engine.liveAstAnalysis().astTree"
                  [useDataLoader]="engine.chaosConfig().useDataLoader"
                  [selectedNode]="engine.selectedAstNode()"
                  (nodeSelected)="engine.selectedAstNode.set($event)"
                />
              </div>
            </mat-tab>

            <mat-tab label="4. Traffic Spike & Concurrency Simulator">
              <div class="tab-pane">
                <app-traffic-spike-svg
                  [report]="engine.trafficSpikeReport()"
                  [concurrency]="engine.spikeConcurrency()"
                  [totalRequests]="engine.spikeTotalRequests()"
                  (concurrencyChange)="onConcurrencyChange($event)"
                  (totalRequestsChange)="onTotalReqChange($event)"
                  (triggerSpike)="engine.runTrafficSpikeSimulation()"
                />
              </div>
            </mat-tab>
          </mat-tab-group>
        </section>
      </main>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100vh;
        background: #060911;
        color: #e2e8f0;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      }
      .devtools-shell {
        max-width: 1620px;
        margin: 0 auto;
        padding: 14px 18px 28px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .top-bar {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 14px;
        background: linear-gradient(180deg, #0f172a 0%, #0b1120 100%);
        border: 1px solid rgba(56, 189, 248, 0.22);
        border-radius: 12px;
        padding: 12px 16px;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .logo-orb {
        width: 42px;
        height: 42px;
        border-radius: 10px;
        background: linear-gradient(135deg, #0ea5e9, #6366f1);
        display: grid;
        place-items: center;
        font-weight: 900;
        font-size: 13px;
        color: #fff;
        letter-spacing: 0.04em;
        box-shadow: 0 0 18px rgba(14, 165, 233, 0.4);
      }
      .brand h1 {
        margin: 0;
        font-size: 17px;
        font-weight: 800;
        color: #f8fafc;
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      .version-pill {
        font-size: 11px;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(56, 189, 248, 0.15);
        color: #38bdf8;
        border: 1px solid rgba(56, 189, 248, 0.3);
      }
      .subtitle {
        margin: 3px 0 0;
        font-size: 12px;
        color: #94a3b8;
      }
      .endpoint-box {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .engine-status {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 11.5px;
        padding: 5px 10px;
        border-radius: 6px;
        background: rgba(56, 189, 248, 0.12);
        color: #38bdf8;
        border: 1px solid rgba(56, 189, 248, 0.25);
        font-weight: 600;
      }
      .engine-status.live {
        background: rgba(20, 184, 166, 0.14);
        color: #2dd4bf;
        border-color: rgba(20, 184, 166, 0.35);
      }
      .engine-status .pulse {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: currentColor;
      }
      .endpoint-input {
        background: #070b14;
        border: 1px solid #334155;
        color: #e2e8f0;
        padding: 6px 10px;
        border-radius: 6px;
        font-size: 12px;
        font-family: 'JetBrains Mono', monospace;
        width: 225px;
      }
      .exec-btn {
        background: linear-gradient(135deg, #0ea5e9, #2563eb);
        color: #fff;
        border: none;
        padding: 8px 15px;
        border-radius: 7px;
        font-weight: 700;
        font-size: 12.5px;
        cursor: pointer;
        box-shadow: 0 2px 10px rgba(14, 165, 233, 0.35);
      }
      .preset-strip {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        background: #0b1120;
        border: 1px solid #1e293b;
        border-radius: 10px;
        padding: 8px 12px;
      }
      .strip-label {
        font-size: 11px;
        font-weight: 800;
        color: #64748b;
        letter-spacing: 0.05em;
        margin-right: 4px;
      }
      .preset-chip {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        background: #0f172a;
        border: 1px solid #1e293b;
        color: #cbd5e1;
        padding: 6px 11px;
        border-radius: 7px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s;
      }
      .preset-chip:hover {
        border-color: #38bdf8;
      }
      .preset-chip.active {
        background: rgba(14, 165, 233, 0.16);
        border-color: #0ea5e9;
        color: #f8fafc;
      }
      .preset-badge {
        font-size: 9.5px;
        font-weight: 800;
        padding: 2px 6px;
        border-radius: 4px;
        background: rgba(56, 189, 248, 0.18);
        color: #38bdf8;
      }
      .kpi-strip {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 12px;
      }
      @media (max-width: 1200px) {
        .kpi-strip {
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        }
      }
      .kpi-card {
        background: #0b1120;
        border: 1px solid #1e293b;
        border-radius: 10px;
        padding: 11px 14px;
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .kpi-card.warn {
        border-color: rgba(245, 158, 11, 0.45);
      }
      .kpi-card.good {
        border-color: rgba(20, 184, 166, 0.45);
      }
      .kpi-card.danger {
        border-color: rgba(239, 68, 68, 0.6);
        background: rgba(239, 68, 68, 0.06);
      }
      .kpi-card.chaos-active {
        border-color: rgba(168, 85, 247, 0.55);
      }
      .k-title {
        font-size: 10.5px;
        font-weight: 700;
        color: #94a3b8;
        letter-spacing: 0.04em;
      }
      .k-value {
        font-size: 22px;
        font-weight: 800;
        color: #f8fafc;
        font-family: 'JetBrains Mono', monospace;
        display: flex;
        align-items: baseline;
        gap: 6px;
      }
      .k-value small {
        font-size: 11.5px;
        font-weight: 600;
        color: #38bdf8;
      }
      .k-foot {
        font-size: 11px;
        color: #64748b;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .workspace-grid {
        display: grid;
        grid-template-columns: 430px 1fr;
        gap: 14px;
        align-items: start;
      }
      @media (max-width: 960px) {
        .workspace-grid {
          grid-template-columns: 1fr;
        }
      }
      .left-panel {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .editor-card,
      .chaos-card {
        background: #0b1120;
        border: 1px solid rgba(56, 189, 248, 0.18);
        border-radius: 10px;
        padding: 12px;
      }
      .editor-tabs {
        display: flex;
        gap: 6px;
        margin-bottom: 8px;
      }
      .editor-tabs button {
        flex: 1;
        background: #0f172a;
        border: 1px solid #1e293b;
        color: #94a3b8;
        padding: 6px 8px;
        border-radius: 6px;
        font-size: 11.5px;
        font-weight: 600;
        cursor: pointer;
      }
      .editor-tabs button.active {
        background: rgba(14, 165, 233, 0.18);
        color: #38bdf8;
        border-color: #0284c7;
      }
      .code-editor {
        width: 100%;
        height: 295px;
        box-sizing: border-box;
        background: #070b14;
        color: #e2e8f0;
        border: 1px solid #1e293b;
        border-radius: 8px;
        padding: 10px;
        font-family: 'JetBrains Mono', monospace;
        font-size: 12px;
        line-height: 1.45;
        resize: vertical;
      }
      .json-preview {
        margin: 0;
        overflow: auto;
        color: #38bdf8;
      }
      .chaos-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
      }
      .chaos-header h3 {
        margin: 0;
        font-size: 14px;
        color: #f8fafc;
      }
      .badge-live {
        font-size: 10px;
        font-weight: 700;
        padding: 2px 7px;
        border-radius: 4px;
        background: rgba(168, 85, 247, 0.2);
        color: #c084fc;
      }
      .toggle-box {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        padding: 9px 11px;
        background: #0f172a;
        border: 1px solid #1e293b;
        border-radius: 8px;
        margin-bottom: 8px;
      }
      .dataloader-box {
        border-color: rgba(20, 184, 166, 0.35);
      }
      .toggle-box strong {
        font-size: 12.5px;
        color: #f8fafc;
        display: block;
      }
      .toggle-box p {
        margin: 2px 0 0;
        font-size: 11px;
        color: #94a3b8;
      }
      .chaos-sliders {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-top: 10px;
      }
      .field-row {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 12px;
        color: #cbd5e1;
      }
      .field-row select {
        background: #070b14;
        color: #f8fafc;
        border: 1px solid #334155;
        padding: 6px 8px;
        border-radius: 6px;
        font-size: 12px;
      }
      .gate-limits {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }
      .gate-limits label {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 11px;
        color: #94a3b8;
      }
      .gate-limits input {
        background: #070b14;
        border: 1px solid #334155;
        color: #f8fafc;
        padding: 5px 8px;
        border-radius: 6px;
        font-family: 'JetBrains Mono', monospace;
      }
      .right-panel {
        background: #0b1120;
        border: 1px solid rgba(56, 189, 248, 0.18);
        border-radius: 10px;
        padding: 6px 12px 14px;
      }
      .tab-pane {
        padding-top: 12px;
      }
    `,
  ],
})
export class AppComponent {
  readonly engine = inject(SandboxEngineService);
  readonly presets = QUERY_PRESETS;
  readonly leftEditorTab = signal<'QUERY' | 'SCHEMA' | 'RESPONSE'>('QUERY');

  selectPreset(preset: QueryPreset) {
    this.engine.selectPreset(preset);
    this.engine.runTrafficSpikeSimulation();
  }

  onQueryEdit(val: string) {
    this.engine.queryText.set(val);
  }

  onChaosToggle(enabled: boolean) {
    const currentMode = this.engine.chaosConfig().mode;
    this.engine.updateChaosPatch({
      enabled,
      mode: enabled && currentMode === 'NONE' ? 'LATENCY_SPIKE' : currentMode,
    });
    this.runAll();
  }

  onChaosModeChange(mode: ChaosConfig['mode']) {
    this.engine.updateChaosPatch({
      mode,
      enabled: mode !== 'NONE',
    });
    this.runAll();
  }

  onLatencyChange(latencyMs: number) {
    this.engine.updateChaosPatch({ latencyMs: Number(latencyMs), enabled: true });
    this.runAll();
  }

  onFailureRateChange(failureRate: number) {
    this.engine.updateChaosPatch({
      failureRate: Number(failureRate),
      enabled: true,
    });
    this.runAll();
  }

  onConcurrencyChange(c: number) {
    this.engine.spikeConcurrency.set(c);
    this.engine.runTrafficSpikeSimulation();
  }

  onTotalReqChange(r: number) {
    this.engine.spikeTotalRequests.set(r);
    this.engine.runTrafficSpikeSimulation();
  }

  runAll() {
    this.engine.executeGraphQLQuery();
    this.engine.runTrafficSpikeSimulation();
  }
}
