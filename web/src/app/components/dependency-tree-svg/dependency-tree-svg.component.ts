import {
  Component,
  input,
  output,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { AstTreeNode } from '../../models/sandbox.models';

interface PositionedGraphNode {
  node: AstTreeNode;
  x: number;
  y: number;
  parentX?: number;
  parentY?: number;
  strokeColor: string;
  badgeColor: string;
}

@Component({
  selector: 'app-dependency-tree-svg',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dep-tree-shell">
      <div class="dep-header">
        <div>
          <h4>Interactive SVG Resolver Dependency & Fan-Out Graph</h4>
          <p>
            Visualizes AST field fan-out multipliers, N+1 relation bottlenecks, and DataLoader batching boundaries.
          </p>
        </div>
        <div class="dep-badges">
          <span class="pill low">LOW RISK (O(1))</span>
          <span class="pill med">MEDIUM</span>
          <span class="pill high">HIGH N+1 FAN-OUT</span>
          <span class="pill crit">CRITICAL MULTIPLIER</span>
        </div>
      </div>

      <div class="dep-svg-wrap">
        <svg
          [attr.viewBox]="'0 0 ' + canvasWidth() + ' ' + canvasHeight()"
          class="dep-svg"
        >
          <defs>
            <marker
              id="arrowCyan"
              markerWidth="7"
              markerHeight="7"
              refX="6"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 7 3.5, 0 7" fill="#38bdf8" />
            </marker>
            <marker
              id="arrowWarn"
              markerWidth="7"
              markerHeight="7"
              refX="6"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 7 3.5, 0 7" fill="#f59e0b" />
            </marker>
          </defs>

          <!-- Bezier Edges -->
          @for (item of positionedNodes(); track item.node.id) {
            @if (item.parentX !== undefined && item.parentY !== undefined) {
              <path
                [attr.d]="buildCubicPath(item.parentX, item.parentY, item.x, item.y)"
                fill="none"
                [attr.stroke]="
                  item.node.estimatedNPlusOneRisk === 'HIGH' ||
                  item.node.estimatedNPlusOneRisk === 'CRITICAL'
                    ? (useDataLoader() ? '#14b8a6' : '#f59e0b')
                    : 'rgba(56, 189, 248, 0.45)'
                "
                [attr.stroke-width]="
                  item.node.estimatedNPlusOneRisk === 'HIGH' ||
                  item.node.estimatedNPlusOneRisk === 'CRITICAL'
                    ? '2.2'
                    : '1.5'
                "
                [attr.stroke-dasharray]="
                  !useDataLoader() &&
                  (item.node.estimatedNPlusOneRisk === 'HIGH' ||
                    item.node.estimatedNPlusOneRisk === 'CRITICAL')
                    ? '5,3'
                    : null
                "
              />
            }
          }

          <!-- Graph Nodes -->
          @for (item of positionedNodes(); track item.node.id) {
            <g
              class="graph-node"
              [attr.transform]="'translate(' + item.x + ',' + item.y + ')'"
              (click)="nodeSelected.emit(item.node)"
            >
              <rect
                x="-82"
                y="-24"
                width="164"
                height="48"
                rx="8"
                fill="#0f172a"
                [attr.stroke]="
                  selectedNode()?.id === item.node.id
                    ? '#38bdf8'
                    : item.strokeColor
                "
                [attr.stroke-width]="
                  selectedNode()?.id === item.node.id ? '2.5' : '1.5'
                "
              />

              <!-- Node Field Name -->
              <text
                x="-70"
                y="-4"
                fill="#f8fafc"
                font-size="11.5"
                font-weight="700"
                font-family="JetBrains Mono, monospace"
              >
                {{ item.node.name }}
              </text>

              <!-- Return Type & Cost -->
              <text
                x="-70"
                y="13"
                fill="#94a3b8"
                font-size="10"
                font-family="JetBrains Mono, monospace"
              >
                {{ item.node.returnTypeHint }} · cost {{ item.node.computedCost }}
              </text>

              <!-- Multiplier Pill -->
              <rect
                x="34"
                y="-18"
                width="40"
                height="16"
                rx="4"
                [attr.fill]="item.badgeColor"
              />
              <text
                x="54"
                y="-7"
                text-anchor="middle"
                fill="#090d16"
                font-size="9.5"
                font-weight="800"
                font-family="JetBrains Mono, monospace"
              >
                ×{{ item.node.multiplier }}
              </text>
            </g>
          }
        </svg>
      </div>
    </div>
  `,
  styles: [
    `
      .dep-tree-shell {
        background: #0b1120;
        border: 1px solid rgba(56, 189, 248, 0.18);
        border-radius: 10px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .dep-header {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
      }
      .dep-header h4 {
        margin: 0;
        font-size: 14px;
        color: #f8fafc;
      }
      .dep-header p {
        margin: 2px 0 0;
        font-size: 12px;
        color: #94a3b8;
      }
      .dep-badges {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .pill {
        font-size: 10px;
        font-weight: 700;
        padding: 3px 8px;
        border-radius: 4px;
      }
      .pill.low {
        background: rgba(20, 184, 166, 0.18);
        color: #2dd4bf;
      }
      .pill.med {
        background: rgba(56, 189, 248, 0.18);
        color: #38bdf8;
      }
      .pill.high {
        background: rgba(245, 158, 11, 0.2);
        color: #fbbf24;
      }
      .pill.crit {
        background: rgba(239, 68, 68, 0.22);
        color: #f87171;
      }
      .dep-svg-wrap {
        overflow-x: auto;
        border: 1px solid #1e293b;
        border-radius: 8px;
        background: #070b14;
      }
      .dep-svg {
        width: 100%;
        min-width: 820px;
        height: 360px;
        display: block;
      }
      .graph-node {
        cursor: pointer;
      }
      .graph-node:hover rect {
        filter: brightness(1.2);
      }
    `,
  ],
})
export class DependencyTreeSvgComponent {
  readonly astRoots = input.required<AstTreeNode[]>();
  readonly useDataLoader = input<boolean>(false);
  readonly selectedNode = input<AstTreeNode | null>(null);
  readonly nodeSelected = output<AstTreeNode>();

  readonly canvasWidth = computed(() => 960);
  readonly canvasHeight = computed(() => 370);

  readonly positionedNodes = computed<PositionedGraphNode[]>(() => {
    const roots = this.astRoots();
    if (!roots || roots.length === 0) return [];

    // Collect only Operation + Object/Relation nodes (or representative leaf fields) so the dependency tree is clean
    const levels = new Map<number, { node: AstTreeNode; parent?: AstTreeNode }[]>();

    const collect = (node: AstTreeNode, parent?: AstTreeNode) => {
      const d = node.depth;
      if (!levels.has(d)) levels.set(d, []);
      const bucket = levels.get(d)!;

      // Include all nodes with children, or up to 2 scalar fields per parent so tree remains readable
      if (node.children.length > 0 || bucket.length < 7) {
        bucket.push({ node, parent });
      }
      for (const child of node.children) {
        collect(child, node);
      }
    };

    collect(roots[0]);

    const coords = new Map<string, { x: number; y: number }>();
    const result: PositionedGraphNode[] = [];
    const maxDepth = Math.max(...Array.from(levels.keys()), 1);
    const colWidth = (this.canvasWidth() - 180) / Math.max(1, maxDepth);

    for (const [depth, entries] of levels.entries()) {
      const x = Math.round(100 + depth * colWidth);
      const count = entries.length;
      const rowSpacing = this.canvasHeight() / (count + 1);

      entries.forEach((entry, idx) => {
        const y = Math.round((idx + 1) * rowSpacing);
        coords.set(entry.node.id, { x, y });

        const parentCoord = entry.parent
          ? coords.get(entry.parent.id)
          : undefined;

        let strokeColor = '#14b8a6';
        let badgeColor = '#2dd4bf';

        if (entry.node.estimatedNPlusOneRisk === 'CRITICAL') {
          strokeColor = this.useDataLoader() ? '#14b8a6' : '#ef4444';
          badgeColor = this.useDataLoader() ? '#2dd4bf' : '#f87171';
        } else if (entry.node.estimatedNPlusOneRisk === 'HIGH') {
          strokeColor = this.useDataLoader() ? '#14b8a6' : '#f59e0b';
          badgeColor = this.useDataLoader() ? '#2dd4bf' : '#fbbf24';
        } else if (entry.node.estimatedNPlusOneRisk === 'MEDIUM') {
          strokeColor = '#38bdf8';
          badgeColor = '#38bdf8';
        }

        result.push({
          node: entry.node,
          x,
          y,
          parentX: parentCoord?.x,
          parentY: parentCoord?.y,
          strokeColor,
          badgeColor,
        });
      });
    }

    return result;
  });

  buildCubicPath(x1: number, y1: number, x2: number, y2: number): string {
    const startX = x1 + 82;
    const endX = x2 - 82;
    const midX = (startX + endX) / 2;
    return `M ${startX} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${endX} ${y2}`;
  }
}
