import {
  Component,
  input,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTreeModule } from '@angular/material/tree';
import { MatStepperModule } from '@angular/material/stepper';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import {
  AstTreeNode,
  QueryComplexityAnalysis,
} from '../../models/sandbox.models';

@Component({
  selector: 'app-ast-inspector',
  standalone: true,
  imports: [
    CommonModule,
    MatTreeModule,
    MatStepperModule,
    MatIconModule,
    MatButtonModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ast-inspector-grid">
      <!-- Left: Custom Angular Material Stepper for AST Validation & Cost Pipeline -->
      <div class="pipeline-card">
        <div class="card-heading">
          <h4>Pre-Execution AST Gatekeeper Pipeline (MatStepper)</h4>
          <span class="sub">
            Static AST traversal evaluates query depth, list multipliers, and N+1 fan-out before invoking Apollo resolvers
          </span>
        </div>

        <mat-stepper orientation="vertical" [linear]="false" class="dark-stepper">
          @for (step of analysis().pipelineSteps; track step.step; let idx = $index) {
            <mat-step [completed]="step.status === 'PASS'">
              <ng-template matStepLabel>
                <div class="step-label-row">
                  <span class="step-title">{{ step.step }}</span>
                  <span class="step-badge" [attr.data-status]="step.status">
                    {{ step.status }} · {{ step.durationUs }}µs
                  </span>
                </div>
              </ng-template>

              <div class="step-body">
                <p class="step-summary">{{ step.summary }}</p>
                <ul class="step-details">
                  @for (detail of step.details; track detail) {
                    <li>{{ detail }}</li>
                  }
                </ul>
              </div>
            </mat-step>
          }
        </mat-stepper>

        @if (analysis().nPlusOneWarnings.length > 0) {
          <div class="nplus-advisory">
            <h5>Detected N+1 Bottleneck Advisories ({{ analysis().nPlusOneWarnings.length }})</h5>
            @for (warn of analysis().nPlusOneWarnings; track warn.path) {
              <div class="advisory-item">
                <div class="adv-top">
                  <code>{{ warn.path }}</code>
                  <span class="adv-delta">
                    {{ warn.estimatedDbCallsWithoutBatching }} SQL calls →
                    {{ warn.estimatedDbCallsWithDataLoader }} DataLoader batch
                  </span>
                </div>
                <p>{{ warn.recommendation }}</p>
              </div>
            }
          </div>
        }
      </div>

      <!-- Right: Custom Angular Material Tree for Deeply Nested AST Inspection -->
      <div class="tree-card">
        <div class="card-heading">
          <div>
            <h4>Deep AST DocumentNode Explorer (MatTree)</h4>
            <span class="sub">
              Inspect per-field cost weights, list fan-out multipliers, and return types across nested selection sets
            </span>
          </div>
        </div>

        <div class="tree-container">
          <mat-tree
            #tree
            [dataSource]="analysis().astTree"
            [childrenAccessor]="childrenAccessor"
            class="dark-mat-tree"
          >
            <!-- Leaf AST Field Node -->
            <mat-tree-node *matTreeNodeDef="let node" matTreeNodePadding>
              <button mat-icon-button disabled></button>
              <div
                class="ast-node-row"
                [class.active]="selectedNode()?.id === node.id"
                (click)="nodeSelected.emit(node)"
              >
                <span class="node-kind" [attr.data-kind]="node.kind">
                  {{ node.kind === 'Field' ? 'FLD' : node.kind }}
                </span>
                <span class="node-name">{{ node.name }}</span>
                <span class="node-type">: {{ node.returnTypeHint }}</span>
                <span class="node-cost">cost {{ node.computedCost }}</span>
              </div>
            </mat-tree-node>

            <!-- Expandable Parent AST Node -->
            <mat-tree-node
              *matTreeNodeDef="let node; when: hasChild"
              matTreeNodePadding
              matTreeNodeToggle
              [cdkTreeNodeTypeaheadLabel]="node.name"
              [isExpanded]="true"
            >
              <button
                mat-icon-button
                matTreeNodeToggle
                [attr.aria-label]="'Toggle ' + node.name"
                class="toggle-btn"
              >
                <span class="chevron">
                  {{ tree.isExpanded(node) ? '▾' : '▸' }}
                </span>
              </button>

              <div
                class="ast-node-row parent-row"
                [class.active]="selectedNode()?.id === node.id"
                (click)="nodeSelected.emit(node)"
              >
                <span class="node-kind" [attr.data-kind]="node.kind">
                  {{ node.kind === 'Operation' ? 'OP' : 'OBJ' }}
                </span>
                <span class="node-name">{{ node.name }}</span>
                @if (node.arguments?.length) {
                  <span class="node-args">
                    ({{ formatArgs(node.arguments) }})
                  </span>
                }
                <span class="node-type">: {{ node.returnTypeHint }}</span>
                <span class="node-mult">×{{ node.multiplier }}</span>
                <span class="node-cost">cost {{ node.computedCost }}</span>
                @if (node.estimatedNPlusOneRisk !== 'LOW') {
                  <span
                    class="risk-tag"
                    [attr.data-risk]="node.estimatedNPlusOneRisk"
                  >
                    {{ node.estimatedNPlusOneRisk }} N+1
                  </span>
                }
              </div>
            </mat-tree-node>
          </mat-tree>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .ast-inspector-grid {
        display: grid;
        grid-template-columns: 1fr 1.15fr;
        gap: 14px;
      }
      @media (max-width: 1100px) {
        .ast-inspector-grid {
          grid-template-columns: 1fr;
        }
      }
      .pipeline-card,
      .tree-card {
        background: #0b1120;
        border: 1px solid rgba(56, 189, 248, 0.18);
        border-radius: 10px;
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .card-heading h4 {
        margin: 0;
        font-size: 14px;
        color: #f8fafc;
      }
      .card-heading .sub {
        font-size: 12px;
        color: #94a3b8;
      }
      .dark-stepper {
        background: transparent !important;
      }
      .step-label-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        width: 100%;
      }
      .step-title {
        color: #e2e8f0;
        font-weight: 600;
        font-size: 13px;
      }
      .step-badge {
        font-size: 10px;
        font-weight: 700;
        padding: 2px 8px;
        border-radius: 4px;
        font-family: 'JetBrains Mono', monospace;
        background: rgba(20, 184, 166, 0.2);
        color: #2dd4bf;
      }
      .step-badge[data-status='WARN'] {
        background: rgba(245, 158, 11, 0.2);
        color: #fbbf24;
      }
      .step-badge[data-status='BLOCK'] {
        background: rgba(239, 68, 68, 0.25);
        color: #f87171;
      }
      .step-body {
        background: #0f172a;
        border: 1px solid #1e293b;
        border-radius: 6px;
        padding: 10px 12px;
        margin-top: 6px;
      }
      .step-summary {
        margin: 0 0 6px;
        color: #cbd5e1;
        font-size: 12px;
      }
      .step-details {
        margin: 0;
        padding-left: 16px;
        color: #94a3b8;
        font-size: 11.5px;
        font-family: 'JetBrains Mono', monospace;
      }
      .nplus-advisory {
        border-top: 1px solid #1e293b;
        padding-top: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .nplus-advisory h5 {
        margin: 0;
        font-size: 12px;
        color: #fbbf24;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .advisory-item {
        background: rgba(245, 158, 11, 0.08);
        border: 1px solid rgba(245, 158, 11, 0.28);
        border-radius: 6px;
        padding: 8px 10px;
        font-size: 11.5px;
      }
      .adv-top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 4px;
      }
      .adv-top code {
        color: #fde68a;
        font-weight: 700;
      }
      .adv-delta {
        color: #2dd4bf;
        font-family: 'JetBrains Mono', monospace;
        font-size: 11px;
      }
      .advisory-item p {
        margin: 0;
        color: #cbd5e1;
      }
      .tree-container {
        max-height: 460px;
        overflow-y: auto;
        background: #070b14;
        border: 1px solid #1e293b;
        border-radius: 8px;
        padding: 8px;
      }
      .dark-mat-tree {
        background: transparent !important;
      }
      .ast-node-row {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 4px 10px;
        border-radius: 6px;
        cursor: pointer;
        font-family: 'JetBrains Mono', monospace;
        font-size: 12px;
        transition: background 0.12s;
      }
      .ast-node-row:hover {
        background: rgba(56, 189, 248, 0.12);
      }
      .ast-node-row.active {
        background: rgba(56, 189, 248, 0.22);
        outline: 1px solid #38bdf8;
      }
      .node-kind {
        font-size: 9.5px;
        font-weight: 800;
        padding: 1px 5px;
        border-radius: 3px;
        background: #1e293b;
        color: #94a3b8;
      }
      .node-kind[data-kind='Operation'] {
        background: rgba(14, 165, 233, 0.25);
        color: #38bdf8;
      }
      .node-name {
        color: #f8fafc;
        font-weight: 600;
      }
      .node-args {
        color: #c084fc;
        font-size: 11px;
      }
      .node-type {
        color: #64748b;
        font-size: 11px;
      }
      .node-mult {
        background: rgba(56, 189, 248, 0.14);
        color: #38bdf8;
        padding: 1px 5px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 700;
      }
      .node-cost {
        color: #94a3b8;
        font-size: 10.5px;
      }
      .risk-tag {
        padding: 1px 6px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 700;
        background: rgba(245, 158, 11, 0.2);
        color: #fbbf24;
      }
      .risk-tag[data-risk='CRITICAL'] {
        background: rgba(239, 68, 68, 0.25);
        color: #f87171;
      }
      .chevron {
        color: #38bdf8;
        font-size: 14px;
      }
    `,
  ],
})
export class AstInspectorComponent {
  readonly analysis = input.required<QueryComplexityAnalysis>();
  readonly selectedNode = input<AstTreeNode | null>(null);
  readonly nodeSelected = output<AstTreeNode>();

  readonly childrenAccessor = (node: AstTreeNode) => node.children ?? [];
  readonly hasChild = (_: number, node: AstTreeNode) =>
    !!node.children && node.children.length > 0;

  formatArgs(args: { name: string; value: string }[]): string {
    return args.map((a) => `${a.name}: ${a.value}`).join(', ');
  }
}
