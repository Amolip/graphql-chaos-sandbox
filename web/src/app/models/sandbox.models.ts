export interface AstTreeNode {
  id: string;
  name: string;
  alias?: string;
  kind: 'Operation' | 'Field' | 'FragmentSpread' | 'InlineFragment';
  depth: number;
  baseCost: number;
  multiplier: number;
  computedCost: number;
  estimatedNPlusOneRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  arguments: { name: string; value: string }[];
  directives: string[];
  returnTypeHint: string;
  children: AstTreeNode[];
}

export interface NPlusOneWarning {
  path: string;
  parentField: string;
  childField: string;
  estimatedDbCallsWithoutBatching: number;
  estimatedDbCallsWithDataLoader: number;
  recommendation: string;
}

export interface PipelineStep {
  step: string;
  status: 'PASS' | 'WARN' | 'BLOCK';
  durationUs: number;
  summary: string;
  details: string[];
}

export interface QueryComplexityAnalysis {
  valid: boolean;
  error?: string;
  operationName: string;
  operationType: string;
  totalComplexityScore: number;
  maxAllowedComplexity: number;
  maxDepth: number;
  maxAllowedDepth: number;
  totalFields: number;
  listMultiplierPaths: string[];
  nPlusOneWarnings: NPlusOneWarning[];
  astTree: AstTreeNode[];
  pipelineSteps: PipelineStep[];
}

export interface ChaosConfig {
  enabled: boolean;
  mode: 'NONE' | 'LATENCY_SPIKE' | 'PARTIAL_FAILURE' | 'DB_POOL_EXHAUSTION' | 'PACKET_JITTER';
  latencyMs: number;
  jitterMs: number;
  failureRate: number;
  targetResolvers: string[];
  useDataLoader: boolean;
  maxComplexity: number;
  maxDepth: number;
}

export interface ResolverTraceSpan {
  id: string;
  path: string;
  parentType: string;
  fieldName: string;
  returnType: string;
  startOffsetMs: number;
  durationMs: number;
  endOffsetMs: number;
  depth: number;
  batchedWithDataLoader: boolean;
  dbQueriesTriggered: number;
  chaosInjected?: {
    type: 'LATENCY' | 'ERROR' | 'JITTER';
    addedLatencyMs: number;
    errorMessage?: string;
  };
  status: 'OK' | 'SLOW' | 'ERROR';
}

export interface SandboxTelemetry {
  timestamp: string;
  totalDurationMs: number;
  dbQueryCount: number;
  dataloaderBatches: number;
  chaosEventsTriggered: number;
  chaosConfig: ChaosConfig;
  astAnalysis: QueryComplexityAnalysis;
  resolverWatermarkCount: number;
  traces: ResolverTraceSpan[];
}

export interface TrafficSpikeBucket {
  requestIndex: number;
  wave: number;
  durationMs: number;
  dbQueries: number;
  status: '200_OK' | '206_PARTIAL' | '429_COMPLEXITY' | '503_CHAOS';
}

export interface TrafficSpikeReport {
  concurrency: number;
  totalRequests: number;
  totalWaves: number;
  useDataLoader: boolean;
  chaosMode: ChaosConfig['mode'];
  metrics: {
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    avgMs: number;
    rpsThroughput: number;
    totalDbQueries: number;
    dbPoolSaturationPct: number;
    errorRatePct: number;
  };
  buckets: TrafficSpikeBucket[];
}

export interface QueryPreset {
  id: string;
  label: string;
  badge: string;
  description: string;
  query: string;
  recommendedChaos?: Partial<ChaosConfig>;
}
