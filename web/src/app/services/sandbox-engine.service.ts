import { Injectable, signal, computed } from '@angular/core';
import {
  parse,
  DocumentNode,
  OperationDefinitionNode,
  FragmentDefinitionNode,
  SelectionSetNode,
  FieldNode,
  Kind,
} from 'graphql';
import {
  AstTreeNode,
  ChaosConfig,
  QueryComplexityAnalysis,
  QueryPreset,
  ResolverTraceSpan,
  SandboxTelemetry,
  TrafficSpikeBucket,
  TrafficSpikeReport,
} from '../models/sandbox.models';

const LIST_FIELD_MULTIPLIERS: Record<string, number> = {
  orders: 8,
  recentOrders: 8,
  items: 4,
  lineItems: 4,
  reviews: 5,
  warehouses: 3,
  inventoryLogs: 6,
  paymentAttempts: 3,
  recommendations: 6,
  auditTrail: 10,
};

const RELATION_RESOLVER_FIELDS = new Set([
  'customer',
  'seller',
  'product',
  'shippingTrack',
  'warehouse',
  'author',
  'paymentLedger',
  'fraudAnalysis',
  'items',
  'reviews',
  'warehouses',
  'orders',
]);

const FIELD_TYPE_HINTS: Record<string, string> = {
  orders: '[Order!]!',
  items: '[OrderItem!]!',
  customer: 'Customer!',
  product: 'Product!',
  seller: 'Merchant!',
  reviews: '[Review!]!',
  shippingTrack: 'ShipmentTelemetry!',
  warehouses: '[WarehouseNode!]!',
  fraudAnalysis: 'FraudRiskScore!',
};

export const QUERY_PRESETS: QueryPreset[] = [
  {
    id: 'n-plus-one-storm',
    label: 'N+1 Resolver Storm (Commerce Order Graph)',
    badge: 'CRITICAL N+1',
    description:
      'Deeply nested Order -> Customer + Items -> Product -> Seller + Reviews + Warehouses query that triggers 47+ unbatched SQL/RPC roundtrips unless DataLoader is enabled.',
    query: `query InspectDistributedOrders($limit: Int = 5) {
  orders(limit: $limit) {
    id
    orderNumber
    status
    totalUsd
    customer {
      id
      name
      vipTier
      region
    }
    shippingTrack {
      carrier
      trackingCode
      currentHub
    }
    fraudAnalysis {
      riskProbability
      decision
      modelVersion
    }
    items {
      id
      quantity
      unitPriceUsd
      product {
        id
        sku
        name
        category
        seller {
          id
          name
          tier
          slaUptimePct
        }
        reviews {
          id
          authorName
          rating
          sentimentScore
        }
        warehouses {
          id
          regionCode
          city
          stockAvailable
        }
      }
    }
  }
}`,
    recommendedChaos: {
      enabled: false,
      mode: 'NONE',
      useDataLoader: false,
    },
  },
  {
    id: 'dataloader-coalesced',
    label: 'DataLoader Coalesced Execution (1-Tick Batching)',
    badge: 'OPTIMIZED',
    description:
      'Same nested commerce graph executed with request-scoped DataLoader<K,V> tick batching enabled — collapses 47+ sequential queries into 6 parallel batch lookups.',
    query: `query InspectBatchedOrderGraph($limit: Int = 5) {
  orders(limit: $limit) {
    id
    orderNumber
    totalUsd
    customer {
      id
      name
      vipTier
    }
    items {
      id
      quantity
      product {
        id
        sku
        name
        seller {
          id
          name
          slaUptimePct
        }
        warehouses {
          city
          stockAvailable
        }
      }
    }
  }
}`,
    recommendedChaos: {
      enabled: false,
      mode: 'NONE',
      useDataLoader: true,
    },
  },
  {
    id: 'chaos-partial-degradation',
    label: 'Chaos Engineering: Partial Subgraph Failure + Latency Injection',
    badge: 'CHAOS INJECTION',
    description:
      'Injects 65ms synthetic latency and 30% partial failure probability into child resolvers (`fraudAnalysis`, `reviews`, `shippingTrack`) to verify resilient GraphQL partial data delivery.',
    query: `query ChaosResilienceProbe($limit: Int = 4) {
  orders(limit: $limit) {
    id
    orderNumber
    status
    totalUsd
    customer {
      name
      vipTier
    }
    shippingTrack {
      carrier
      trackingCode
      status
    }
    fraudAnalysis {
      riskProbability
      decision
    }
    items {
      quantity
      product {
        sku
        name
        reviews {
          rating
          comment
        }
      }
    }
  }
}`,
    recommendedChaos: {
      enabled: true,
      mode: 'PARTIAL_FAILURE',
      latencyMs: 65,
      jitterMs: 40,
      failureRate: 0.3,
      useDataLoader: false,
    },
  },
  {
    id: 'depth-bomb-guard',
    label: 'AST Security Gate: Deep Nesting & Cost Budget Overflow',
    badge: 'AST GUARD',
    description:
      'High-multiplier query (`limit: 12`) with deep fragment spreads that trips the static AST Complexity & Depth Gatekeeper before touching downstream database pools.',
    query: `query DeepWarehouseAudit($limit: Int = 12) {
  orders(limit: $limit) {
    id
    orderNumber
    ...OrderCustomerFields
    items {
      id
      quantity
      product {
        id
        sku
        seller {
          id
          name
          primaryRegion
        }
        reviews {
          id
          rating
          sentimentScore
        }
        warehouses {
          id
          regionCode
          city
          stockAvailable
          dispatchLatencyMs
        }
      }
    }
  }
}

fragment OrderCustomerFields on Order {
  customer {
    id
    name
    email
    vipTier
    region
  }
  fraudAnalysis {
    id
    riskProbability
    decision
  }
}`,
    recommendedChaos: {
      enabled: true,
      mode: 'DB_POOL_EXHAUSTION',
      latencyMs: 45,
      useDataLoader: false,
      maxComplexity: 180,
      maxDepth: 5,
    },
  },
];

export const DEFAULT_SDL_SCHEMA = `type Query {
  orders(limit: Int = 5): [Order!]!
}

type Order {
  id: ID!
  orderNumber: String!
  status: String!
  totalUsd: Float!
  createdAt: String!
  customer: Customer!          # @ResolveField -> DataLoader<CustomerId, Customer>
  items: [OrderItem!]!         # @ResolveField -> DataLoader<OrderId, OrderItem[]>
  shippingTrack: ShipmentTelemetry!
  fraudAnalysis: FraudRiskScore
}

type OrderItem {
  id: ID!
  quantity: Int!
  unitPriceUsd: Float!
  product: Product!            # @ResolveField -> DataLoader<ProductId, Product>
}

type Product {
  id: ID!
  sku: String!
  name: String!
  category: String!
  priceUsd: Float!
  seller: Merchant!            # @ResolveField -> DataLoader<SellerId, Merchant>
  reviews: [Review!]!          # @ResolveField -> N+1 Hotspot
  warehouses: [WarehouseNode!]!
}`;

@Injectable({ providedIn: 'root' })
export class SandboxEngineService {
  readonly endpointUrl = signal<string>('http://localhost:3333/graphql');
  readonly connectionMode = signal<'LIVE_NESTJS' | 'IN_BROWSER_SANDBOX'>('LIVE_NESTJS');
  readonly schemaSdl = signal<string>(DEFAULT_SDL_SCHEMA);
  readonly activePresetId = signal<string>(QUERY_PRESETS[0].id);
  readonly queryText = signal<string>(QUERY_PRESETS[0].query);

  readonly chaosConfig = signal<ChaosConfig>({
    enabled: false,
    mode: 'NONE',
    latencyMs: 55,
    jitterMs: 35,
    failureRate: 0.25,
    targetResolvers: [],
    useDataLoader: false,
    maxComplexity: 250,
    maxDepth: 6,
  });

  readonly isExecuting = signal<boolean>(false);
  readonly isSimulatingSpike = signal<boolean>(false);

  readonly latestTelemetry = signal<SandboxTelemetry | null>(null);
  readonly latestResponseJson = signal<string>('');
  readonly selectedSpan = signal<ResolverTraceSpan | null>(null);
  readonly selectedAstNode = signal<AstTreeNode | null>(null);

  readonly spikeConcurrency = signal<number>(35);
  readonly spikeTotalRequests = signal<number>(80);
  readonly trafficSpikeReport = signal<TrafficSpikeReport | null>(null);

  // Real-time reactive AST complexity & depth analysis computed via Angular Signals
  readonly liveAstAnalysis = computed<QueryComplexityAnalysis>(() => {
    const q = this.queryText();
    const cfg = this.chaosConfig();
    return this.analyzeAstClientSide(q, cfg.maxComplexity, cfg.maxDepth);
  });

  constructor() {
    // Run initial query execution automatically so flamegraphs, dependency trees, and metrics are populated on first load
    setTimeout(() => {
      this.executeGraphQLQuery();
      this.runTrafficSpikeSimulation();
    }, 50);
  }

  selectPreset(preset: QueryPreset) {
    this.activePresetId.set(preset.id);
    this.queryText.set(preset.query);
    if (preset.recommendedChaos) {
      this.chaosConfig.update((curr) => ({
        ...curr,
        ...preset.recommendedChaos,
      }));
    }
    this.executeGraphQLQuery();
  }

  toggleDataLoader(useDataLoader: boolean) {
    this.chaosConfig.update((c) => ({ ...c, useDataLoader }));
    this.executeGraphQLQuery();
    this.runTrafficSpikeSimulation();
  }

  updateChaosPatch(patch: Partial<ChaosConfig>) {
    this.chaosConfig.update((c) => ({ ...c, ...patch }));
  }

  async executeGraphQLQuery(): Promise<void> {
    this.isExecuting.set(true);
    const query = this.queryText();
    const cfg = this.chaosConfig();
    const url = this.endpointUrl();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-chaos-config': JSON.stringify(cfg),
        },
        body: JSON.stringify({ query }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const payload = await response.json();
      if (payload?.extensions?.sandboxTelemetry) {
        this.connectionMode.set('LIVE_NESTJS');
        const telemetry: SandboxTelemetry = payload.extensions.sandboxTelemetry;
        this.latestTelemetry.set(telemetry);
        this.selectedSpan.set(telemetry.traces[0] || null);
        this.selectedAstNode.set(telemetry.astAnalysis?.astTree?.[0] || null);
        this.latestResponseJson.set(
          JSON.stringify(
            {
              data: payload.data,
              errors: payload.errors,
              extensions: {
                totalDurationMs: telemetry.totalDurationMs,
                dbQueryCount: telemetry.dbQueryCount,
                dataloaderBatches: telemetry.dataloaderBatches,
                resolverWatermarkCount: telemetry.resolverWatermarkCount,
              },
            },
            null,
            2,
          ),
        );
        this.isExecuting.set(false);
        return;
      }
    } catch {
      // Fallback to deterministic high-precision browser simulation when running on static GitHub Pages
    }

    this.connectionMode.set('IN_BROWSER_SANDBOX');
    const simulated = this.buildBrowserSimulatedTelemetry(query, cfg);
    this.latestTelemetry.set(simulated.telemetry);
    this.selectedSpan.set(simulated.telemetry.traces[0] || null);
    this.selectedAstNode.set(simulated.telemetry.astAnalysis?.astTree?.[0] || null);
    this.latestResponseJson.set(JSON.stringify(simulated.responsePayload, null, 2));
    this.isExecuting.set(false);
  }

  async runTrafficSpikeSimulation(): Promise<void> {
    this.isSimulatingSpike.set(true);
    const cfg = this.chaosConfig();
    const ast = this.liveAstAnalysis();
    const concurrency = this.spikeConcurrency();
    const totalRequests = this.spikeTotalRequests();

    const apiBase = this.endpointUrl().replace(/\/graphql\/?$/, '');
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2200);
      const res = await fetch(`${apiBase}/api/sandbox/traffic-spike`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          concurrency,
          totalRequests,
          useDataLoader: cfg.useDataLoader,
          chaosMode: cfg.enabled ? cfg.mode : 'NONE',
          latencyMs: cfg.latencyMs,
          failureRate: cfg.failureRate,
          queryComplexity: ast.totalComplexityScore || 72,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        const report: TrafficSpikeReport = await res.json();
        this.trafficSpikeReport.set(report);
        this.isSimulatingSpike.set(false);
        return;
      }
    } catch {
      // Use deterministic browser traffic spike generator
    }

    const report = this.buildLocalTrafficSpikeReport(
      concurrency,
      totalRequests,
      cfg,
      ast.totalComplexityScore || 72,
    );
    this.trafficSpikeReport.set(report);
    this.isSimulatingSpike.set(false);
  }

  analyzeAstClientSide(
    querySource: string,
    maxAllowedComplexity = 250,
    maxAllowedDepth = 6,
  ): QueryComplexityAnalysis {
    const t0 = performance.now();
    let doc: DocumentNode;

    try {
      doc = parse(querySource, { noLocation: false });
    } catch (err: any) {
      return {
        valid: false,
        error: err?.message || 'Syntax Error in GraphQL query',
        operationName: 'SyntaxError',
        operationType: 'query',
        totalComplexityScore: 0,
        maxAllowedComplexity,
        maxDepth: 0,
        maxAllowedDepth,
        totalFields: 0,
        listMultiplierPaths: [],
        nPlusOneWarnings: [],
        astTree: [],
        pipelineSteps: [
          {
            step: '1. Lexical & Syntactic AST Parse',
            status: 'BLOCK',
            durationUs: 95,
            summary: 'GraphQL parser rejected malformed token stream.',
            details: [err?.message || 'Syntax Error'],
          },
        ],
      };
    }

    const parseUs = Math.max(42, Math.round((performance.now() - t0) * 1000));
    const fragments = new Map<string, FragmentDefinitionNode>();
    const operations: OperationDefinitionNode[] = [];

    for (const def of doc.definitions) {
      if (def.kind === Kind.FRAGMENT_DEFINITION) {
        fragments.set(def.name.value, def);
      } else if (def.kind === Kind.OPERATION_DEFINITION) {
        operations.push(def);
      }
    }

    const primaryOp = operations[0];
    if (!primaryOp) {
      return {
        valid: false,
        error: 'No GraphQL operation definition found.',
        operationName: 'Empty',
        operationType: 'query',
        totalComplexityScore: 0,
        maxAllowedComplexity,
        maxDepth: 0,
        maxAllowedDepth,
        totalFields: 0,
        listMultiplierPaths: [],
        nPlusOneWarnings: [],
        astTree: [],
        pipelineSteps: [],
      };
    }

    let maxDepth = 0;
    let totalFields = 0;
    let totalComplexityScore = 0;
    const listMultiplierPaths: string[] = [];
    const nPlusOneWarnings: QueryComplexityAnalysis['nPlusOneWarnings'] = [];
    let nodeCounter = 0;

    const walk = (
      selectionSet: SelectionSetNode | undefined,
      currentDepth: number,
      parentMultiplier: number,
      parentPath: string,
      parentFieldName: string,
      parentIsList: boolean,
    ): AstTreeNode[] => {
      if (!selectionSet) return [];
      const nodes: AstTreeNode[] = [];

      for (const selection of selectionSet.selections) {
        if (selection.kind === Kind.FIELD) {
          const fieldNode = selection as FieldNode;
          const fieldName = fieldNode.name.value;
          if (fieldName.startsWith('__')) continue;

          totalFields++;
          const depth = currentDepth + 1;
          if (depth > maxDepth) maxDepth = depth;
          const path = parentPath ? `${parentPath}.${fieldName}` : fieldName;

          const args: { name: string; value: string }[] = [];
          let explicitLimit: number | undefined;

          for (const arg of fieldNode.arguments || []) {
            let valStr = '';
            if (arg.value.kind === Kind.INT) {
              valStr = arg.value.value;
              if (['limit', 'first', 'take', 'count'].includes(arg.name.value)) {
                explicitLimit = Math.max(1, parseInt(valStr, 10));
              }
            } else if (arg.value.kind === Kind.VARIABLE) {
              valStr = `$${arg.value.name.value}`;
              if (arg.name.value === 'limit') explicitLimit = 5;
            } else if (arg.value.kind === Kind.STRING) {
              valStr = `"${arg.value.value}"`;
            } else {
              valStr = 'Value';
            }
            args.push({ name: arg.name.value, value: valStr });
          }

          const isListField = fieldName in LIST_FIELD_MULTIPLIERS;
          const localMultiplier =
            explicitLimit ??
            (isListField ? LIST_FIELD_MULTIPLIERS[fieldName] : 1);
          const effectiveMultiplier = parentMultiplier * localMultiplier;

          if (isListField || explicitLimit) {
            listMultiplierPaths.push(`${path} (×${localMultiplier})`);
          }

          const hasSubfields = Boolean(
            fieldNode.selectionSet &&
              fieldNode.selectionSet.selections.length > 0,
          );
          const isRelationResolver = RELATION_RESOLVER_FIELDS.has(fieldName);
          const baseCost = isRelationResolver ? 3 : hasSubfields ? 2 : 1;
          const computedCost = baseCost * parentMultiplier;
          totalComplexityScore += computedCost;

          let risk: AstTreeNode['estimatedNPlusOneRisk'] = 'LOW';
          if (parentIsList && isRelationResolver) {
            risk =
              parentMultiplier >= 15
                ? 'CRITICAL'
                : parentMultiplier >= 5
                  ? 'HIGH'
                  : 'MEDIUM';
            nPlusOneWarnings.push({
              path,
              parentField: parentFieldName,
              childField: fieldName,
              estimatedDbCallsWithoutBatching: parentMultiplier,
              estimatedDbCallsWithDataLoader: 1,
              recommendation: `Coalesce "${fieldName}" resolver with DataLoader<string, ${
                FIELD_TYPE_HINTS[fieldName]?.replace(/[\[\]!]/g, '') || 'Entity'
              }> to collapse ${parentMultiplier} N+1 queries into 1 batch tick.`,
            });
          } else if (isRelationResolver && depth >= 3) {
            risk = 'MEDIUM';
          }

          const children = walk(
            fieldNode.selectionSet,
            depth,
            effectiveMultiplier,
            path,
            fieldName,
            isListField || parentIsList,
          );

          nodes.push({
            id: `ast-node-${++nodeCounter}`,
            name: fieldName,
            alias: fieldNode.alias?.value,
            kind: 'Field',
            depth,
            baseCost,
            multiplier: parentMultiplier,
            computedCost,
            estimatedNPlusOneRisk: risk,
            arguments: args,
            directives: (fieldNode.directives || []).map(
              (d) => `@${d.name.value}`,
            ),
            returnTypeHint:
              FIELD_TYPE_HINTS[fieldName] ||
              (hasSubfields ? 'Object' : 'Scalar'),
            children,
          });
        } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
          const fragName = selection.name.value;
          const fragDef = fragments.get(fragName);
          if (fragDef) {
            const fragChildren = walk(
              fragDef.selectionSet,
              currentDepth + 1,
              parentMultiplier,
              `${parentPath}...${fragName}`,
              parentFieldName,
              parentIsList,
            );
            nodes.push({
              id: `ast-node-${++nodeCounter}`,
              name: `...${fragName} (on ${fragDef.typeCondition.name.value})`,
              kind: 'FragmentSpread',
              depth: currentDepth + 1,
              baseCost: 1,
              multiplier: parentMultiplier,
              computedCost: parentMultiplier,
              estimatedNPlusOneRisk: 'LOW',
              arguments: [],
              directives: [],
              returnTypeHint: fragDef.typeCondition.name.value,
              children: fragChildren,
            });
          }
        }
      }
      return nodes;
    };

    const opName = primaryOp.name?.value || 'AnonymousOperation';
    const rootChildren = walk(
      primaryOp.selectionSet,
      0,
      1,
      opName,
      opName,
      false,
    );

    const rootNode: AstTreeNode = {
      id: 'ast-root-0',
      name: `${primaryOp.operation} ${opName}`,
      kind: 'Operation',
      depth: 0,
      baseCost: 1,
      multiplier: 1,
      computedCost: totalComplexityScore,
      estimatedNPlusOneRisk:
        nPlusOneWarnings.length > 2
          ? 'CRITICAL'
          : nPlusOneWarnings.length > 0
            ? 'HIGH'
            : 'LOW',
      arguments: (primaryOp.variableDefinitions || []).map((v) => ({
        name: `$${v.variable.name.value}`,
        value: 'Var',
      })),
      directives: [],
      returnTypeHint: 'QueryRoot',
      children: rootChildren,
    };

    const depthStatus =
      maxDepth > maxAllowedDepth
        ? 'BLOCK'
        : maxDepth >= maxAllowedDepth - 1
          ? 'WARN'
          : 'PASS';
    const complexityStatus =
      totalComplexityScore > maxAllowedComplexity
        ? 'BLOCK'
        : totalComplexityScore > maxAllowedComplexity * 0.75
          ? 'WARN'
          : 'PASS';

    return {
      valid: true,
      operationName: opName,
      operationType: primaryOp.operation,
      totalComplexityScore,
      maxAllowedComplexity,
      maxDepth,
      maxAllowedDepth,
      totalFields,
      listMultiplierPaths,
      nPlusOneWarnings,
      astTree: [rootNode],
      pipelineSteps: [
        {
          step: '1. Lexical & Syntactic AST Parse',
          status: 'PASS',
          durationUs: parseUs,
          summary: `Parsed ${totalFields} AST field nodes across ${operations.length} operation(s) and ${fragments.size} fragment(s).`,
          details: [
            `Operation: ${primaryOp.operation.toUpperCase()} "${opName}"`,
            `AST Field Selection Nodes: ${totalFields}`,
            `Named Fragments Expanded: ${fragments.size}`,
          ],
        },
        {
          step: '2. Query Depth Gatekeeper',
          status: depthStatus,
          durationUs: 38,
          summary: `Measured AST nesting depth ${maxDepth} against limit ${maxAllowedDepth}.`,
          details: [
            `Max Nesting Depth: ${maxDepth} levels`,
            `Configured Max Depth: ${maxAllowedDepth} levels`,
            depthStatus === 'BLOCK'
              ? `REJECTED: Depth ${maxDepth} exceeds security gate ${maxAllowedDepth}.`
              : 'PASSED: Nesting depth within threshold.',
          ],
        },
        {
          step: '3. Cost & List Multiplier Static Analysis',
          status: complexityStatus,
          durationUs: 54,
          summary: `Calculated static complexity score ${totalComplexityScore} pts (budget: ${maxAllowedComplexity} pts).`,
          details: [
            `Total Weighted Cost Score: ${totalComplexityScore} pts`,
            `List Multipliers: ${listMultiplierPaths.join(', ') || '1x'}`,
          ],
        },
        {
          step: '4. N+1 Resolver Fan-out Predictor',
          status: nPlusOneWarnings.length > 0 ? 'WARN' : 'PASS',
          durationUs: 31,
          summary:
            nPlusOneWarnings.length > 0
              ? `Flagged ${nPlusOneWarnings.length} nested list relation resolver fan-out hotspots.`
              : 'Zero unbatched N+1 relation hotspots detected.',
          details:
            nPlusOneWarnings.length > 0
              ? nPlusOneWarnings.map(
                  (w) =>
                    `${w.path}: ${w.estimatedDbCallsWithoutBatching} unbatched DB hits -> ${w.estimatedDbCallsWithDataLoader} via DataLoader`,
                )
              : ['All resolvers execute in O(1) batches.'],
        },
      ],
    };
  }

  private buildBrowserSimulatedTelemetry(
    query: string,
    cfg: ChaosConfig,
  ): { telemetry: SandboxTelemetry; responsePayload: any } {
    const astAnalysis = this.analyzeAstClientSide(
      query,
      cfg.maxComplexity,
      cfg.maxDepth,
    );
    const traces: ResolverTraceSpan[] = [];
    let cursorMs = 0.8;
    let spanCounter = 0;
    let chaosEvents = 0;

    const addSpan = (
      path: string,
      parentType: string,
      fieldName: string,
      returnType: string,
      depth: number,
      baseMs: number,
      parallelOffsetMs?: number,
    ) => {
      const start =
        parallelOffsetMs !== undefined ? parallelOffsetMs : cursorMs;
      let chaosLatency = 0;
      let chaosType: 'LATENCY' | 'ERROR' | 'JITTER' | undefined;
      let errMsg: string | undefined;

      if (cfg.enabled && depth >= 2) {
        if (cfg.mode === 'LATENCY_SPIKE') {
          chaosLatency = cfg.latencyMs;
          chaosType = 'LATENCY';
          chaosEvents++;
        } else if (cfg.mode === 'PACKET_JITTER') {
          chaosLatency = Math.round(cfg.latencyMs * 0.5 + ((spanCounter * 19) % Math.max(15, cfg.jitterMs)));
          chaosType = 'JITTER';
          chaosEvents++;
        } else if (cfg.mode === 'DB_POOL_EXHAUSTION' && !cfg.useDataLoader) {
          chaosLatency = Math.min(180, spanCounter * 8);
          chaosType = 'LATENCY';
          chaosEvents++;
        }

        if (
          cfg.mode === 'PARTIAL_FAILURE' &&
          ((spanCounter * 29) % 100) / 100 < (cfg.failureRate || 0.28)
        ) {
          chaosType = 'ERROR';
          chaosLatency = Math.round(cfg.latencyMs * 0.6);
          errMsg = `[ChaosEngine:PARTIAL_FAILURE] Injected upstream timeout in ${parentType}.${fieldName} (${path})`;
          chaosEvents++;
        }
      }

      const duration = Number((baseMs + chaosLatency).toFixed(2));
      const end = Number((start + duration).toFixed(2));
      if (parallelOffsetMs === undefined) {
        cursorMs = Number((end + 0.35).toFixed(2));
      } else {
        cursorMs = Math.max(cursorMs, end);
      }

      traces.push({
        id: `span-${++spanCounter}`,
        path,
        parentType,
        fieldName,
        returnType,
        startOffsetMs: Number(start.toFixed(2)),
        durationMs: duration,
        endOffsetMs: end,
        depth,
        batchedWithDataLoader: cfg.useDataLoader,
        dbQueriesTriggered: cfg.useDataLoader ? (spanCounter <= 6 ? 1 : 0) : 1,
        chaosInjected: chaosType
          ? {
              type: chaosType,
              addedLatencyMs: chaosLatency,
              errorMessage: errMsg,
            }
          : undefined,
        status:
          chaosType === 'ERROR'
            ? 'ERROR'
            : duration > 42
              ? 'SLOW'
              : 'OK',
      });
    };

    // Root query span
    addSpan('orders', 'Query', 'orders', '[Order!]!', 1, 9.4, 0.5);
    const rootEnd = 10.2;

    const orderCount = query.includes('limit: 12') ? 6 : 5;
    const hasCustomer = query.includes('customer');
    const hasShipping = query.includes('shippingTrack');
    const hasFraud = query.includes('fraudAnalysis');
    const hasItems = query.includes('items');
    const hasProduct = query.includes('product');
    const hasSeller = query.includes('seller');
    const hasReviews = query.includes('reviews');
    const hasWarehouses = query.includes('warehouses');

    cursorMs = rootEnd;

    for (let i = 0; i < orderCount; i++) {
      const batchWindowStart = rootEnd + (cfg.useDataLoader ? 0.6 : i * 28);

      if (hasCustomer) {
        addSpan(
          `orders.${i}.customer`,
          'Order',
          'customer',
          'Customer!',
          2,
          cfg.useDataLoader ? 6.8 : 13.5,
          cfg.useDataLoader ? batchWindowStart : undefined,
        );
      }
      if (hasShipping) {
        addSpan(
          `orders.${i}.shippingTrack`,
          'Order',
          'shippingTrack',
          'ShipmentTelemetry!',
          2,
          cfg.useDataLoader ? 5.9 : 14.2,
          cfg.useDataLoader ? batchWindowStart + 0.4 : undefined,
        );
      }
      if (hasFraud) {
        addSpan(
          `orders.${i}.fraudAnalysis`,
          'Order',
          'fraudAnalysis',
          'FraudRiskScore',
          2,
          cfg.useDataLoader ? 7.2 : 17.6,
          cfg.useDataLoader ? batchWindowStart + 0.8 : undefined,
        );
      }
      if (hasItems) {
        const itemSpanStart = cfg.useDataLoader
          ? batchWindowStart + 1.2
          : undefined;
        addSpan(
          `orders.${i}.items`,
          'Order',
          'items',
          '[OrderItem!]!',
          2,
          cfg.useDataLoader ? 7.5 : 14.8,
          itemSpanStart,
        );

        if (hasProduct) {
          const prodBatchStart = cfg.useDataLoader ? rootEnd + 9.2 : undefined;
          addSpan(
            `orders.${i}.items.0.product`,
            'OrderItem',
            'product',
            'Product!',
            3,
            cfg.useDataLoader ? 6.1 : 12.9,
            prodBatchStart,
          );

          if (hasSeller) {
            addSpan(
              `orders.${i}.items.0.product.seller`,
              'Product',
              'seller',
              'Merchant!',
              4,
              cfg.useDataLoader ? 5.2 : 11.4,
              cfg.useDataLoader ? rootEnd + 16.0 : undefined,
            );
          }
          if (hasReviews) {
            addSpan(
              `orders.${i}.items.0.product.reviews`,
              'Product',
              'reviews',
              '[Review!]!',
              4,
              cfg.useDataLoader ? 6.4 : 14.7,
              cfg.useDataLoader ? rootEnd + 16.5 : undefined,
            );
          }
          if (hasWarehouses) {
            addSpan(
              `orders.${i}.items.0.product.warehouses`,
              'Product',
              'warehouses',
              '[WarehouseNode!]!',
              4,
              cfg.useDataLoader ? 5.8 : 12.3,
              cfg.useDataLoader ? rootEnd + 17.0 : undefined,
            );
          }
        }
      }
    }

    const totalDurationMs = Number(
      Math.max(...traces.map((t) => t.endOffsetMs), 12).toFixed(2),
    );
    const dbQueryCount = cfg.useDataLoader
      ? Math.min(6, traces.length)
      : traces.length;
    const dataloaderBatches = cfg.useDataLoader ? 5 : 0;

    const telemetry: SandboxTelemetry = {
      timestamp: new Date().toISOString(),
      totalDurationMs,
      dbQueryCount,
      dataloaderBatches,
      chaosEventsTriggered: chaosEvents,
      chaosConfig: cfg,
      astAnalysis,
      resolverWatermarkCount: traces.length,
      traces,
    };

    const errors = traces
      .filter((t) => t.status === 'ERROR')
      .map((t) => ({
        message: t.chaosInjected?.errorMessage,
        path: t.path.split('.'),
        extensions: { code: 'CHAOS_INJECTED_PARTIAL_FAILURE' },
      }));

    return {
      telemetry,
      responsePayload: {
        data: {
          orders: Array.from({ length: orderCount }, (_, idx) => ({
            id: `ord-900${idx + 1}`,
            orderNumber: `ORD-2026-900${idx + 1}`,
            status: idx % 2 === 0 ? 'DISPATCHED' : 'IN_TRANSIT',
            totalUsd: 24500 + idx * 8200,
            customer: {
              id: `cust-${idx + 1}`,
              name: ['Aarav Kulkarni', 'Elena Rostova', 'Marcus Vance', 'Priya Nair', 'Kenji Takahashi'][idx % 5],
              vipTier: idx % 2 === 0 ? 'PLATINUM' : 'ENTERPRISE',
            },
          })),
        },
        errors: errors.length > 0 ? errors : undefined,
        extensions: {
          totalDurationMs,
          dbQueryCount,
          dataloaderBatches,
          chaosEventsTriggered: chaosEvents,
        },
      },
    };
  }

  private buildLocalTrafficSpikeReport(
    concurrency: number,
    totalRequests: number,
    cfg: ChaosConfig,
    complexity: number,
  ): TrafficSpikeReport {
    const useDataLoader = cfg.useDataLoader;
    const chaosMode = cfg.enabled ? cfg.mode : 'NONE';
    const buckets: TrafficSpikeBucket[] = [];
    const totalWaves = Math.ceil(totalRequests / concurrency);

    for (let i = 0; i < totalRequests; i++) {
      const wave = Math.floor(i / concurrency) + 1;
      const loadFactor =
        1 + (concurrency / 45) * (useDataLoader ? 0.22 : 1.15);
      const baseMs = useDataLoader
        ? 18 + (complexity / 25) * 2.4
        : 74 + (complexity / 15) * 9.5;
      const chaosPenalty =
        chaosMode === 'LATENCY_SPIKE'
          ? cfg.latencyMs
          : chaosMode === 'PACKET_JITTER'
            ? cfg.latencyMs * 0.5 + ((i * 23) % Math.max(20, cfg.jitterMs))
            : chaosMode === 'DB_POOL_EXHAUSTION' && !useDataLoader
              ? concurrency * 4.2
              : 0;
      const jitter = (Math.sin(i * 1.7) + 1.2) * (useDataLoader ? 4.5 : 18.5);
      const durationMs = Number(
        (baseMs * loadFactor + chaosPenalty + jitter).toFixed(1),
      );
      const dbQueries = useDataLoader
        ? 5
        : Math.max(12, Math.round(complexity * 0.42));

      let status: TrafficSpikeBucket['status'] = '200_OK';
      if (
        chaosMode === 'PARTIAL_FAILURE' &&
        ((i * 17) % 100) / 100 < (cfg.failureRate || 0.25)
      ) {
        status = i % 3 === 0 ? '503_CHAOS' : '206_PARTIAL';
      } else if (
        chaosMode === 'DB_POOL_EXHAUSTION' &&
        !useDataLoader &&
        durationMs > 280
      ) {
        status = '503_CHAOS';
      }

      buckets.push({
        requestIndex: i + 1,
        wave,
        durationMs,
        dbQueries,
        status,
      });
    }

    const sorted = [...buckets].map((b) => b.durationMs).sort((a, b) => a - b);
    const p50Ms = sorted[Math.floor(sorted.length * 0.5)] || 0;
    const p95Ms = sorted[Math.floor(sorted.length * 0.95)] || 0;
    const p99Ms = sorted[Math.floor(sorted.length * 0.99)] || 0;
    const avgMs = Number(
      (sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(1),
    );
    const totalDbQueries = buckets.reduce((a, b) => a + b.dbQueries, 0);
    const errorCount = buckets.filter((b) => b.status !== '200_OK').length;

    return {
      concurrency,
      totalRequests,
      totalWaves,
      useDataLoader,
      chaosMode,
      metrics: {
        p50Ms,
        p95Ms,
        p99Ms,
        avgMs,
        rpsThroughput: Number(
          ((concurrency * 1000) / Math.max(10, avgMs)).toFixed(1),
        ),
        totalDbQueries,
        dbPoolSaturationPct: Math.min(
          100,
          Math.round(
            (totalDbQueries / (totalRequests * (useDataLoader ? 18 : 6))) * 35,
          ),
        ),
        errorRatePct: Number(((errorCount / totalRequests) * 100).toFixed(1)),
      },
      buckets,
    };
  }
}
