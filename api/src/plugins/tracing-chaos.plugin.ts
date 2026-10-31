import { ApolloServerPlugin, GraphQLRequestListener } from '@apollo/server';
import { Plugin } from '@nestjs/apollo';
import {
  AstComplexityAnalyzer,
  QueryComplexityAnalysis,
} from '../ast/ast-complexity.analyzer';

export interface ChaosConfig {
  enabled: boolean;
  mode: 'NONE' | 'LATENCY_SPIKE' | 'PARTIAL_FAILURE' | 'DB_POOL_EXHAUSTION' | 'PACKET_JITTER';
  latencyMs: number;
  jitterMs: number;
  failureRate: number; // 0 to 1
  targetResolvers: string[]; // empty means any relation resolver
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

export interface SandboxRequestContext {
  requestStartNs: bigint;
  chaosConfig: ChaosConfig;
  traces: ResolverTraceSpan[];
  dbQueryCount: number;
  dataloaderBatches: number;
  chaosEventsTriggered: number;
  astAnalysis?: QueryComplexityAnalysis;
}

@Plugin()
export class TracingChaosApolloPlugin implements ApolloServerPlugin<SandboxRequestContext> {
  async requestDidStart(): Promise<GraphQLRequestListener<SandboxRequestContext>> {
    const requestStartNs = process.hrtime.bigint();

    return {
      async didResolveOperation(requestContext) {
        const { request, contextValue } = requestContext;
        contextValue.requestStartNs = requestStartNs;
        contextValue.traces = contextValue.traces || [];
        contextValue.dbQueryCount = contextValue.dbQueryCount || 0;
        contextValue.dataloaderBatches = contextValue.dataloaderBatches || 0;
        contextValue.chaosEventsTriggered = contextValue.chaosEventsTriggered || 0;

        if (request.query && !request.query.includes('__schema')) {
          const maxComplexity = contextValue.chaosConfig?.maxComplexity ?? 250;
          const maxDepth = contextValue.chaosConfig?.maxDepth ?? 8;
          contextValue.astAnalysis = AstComplexityAnalyzer.analyze(
            request.query,
            maxComplexity,
            maxDepth,
          );
        }
      },

      async executionDidStart() {
        return {
          willResolveField({ info, contextValue }) {
            // Skip trivial scalar fields that are already plain properties unless they are root Query fields
            const isRoot = info.parentType.name === 'Query' || info.parentType.name === 'Mutation';
            const isObjectRelation =
              !['String', 'Int', 'Float', 'Boolean', 'ID'].includes(
                info.returnType.toString().replace(/[\[\]!]/g, ''),
              );

            if (!isRoot && !isObjectRelation) {
              return;
            }

            const spanStartNs = process.hrtime.bigint();
            const startOffsetMs =
              Number(spanStartNs - (contextValue.requestStartNs || spanStartNs)) /
              1_000_000;

            const pathArray: (string | number)[] = [];
            let cur: any = info.path;
            while (cur) {
              pathArray.unshift(cur.key);
              cur = cur.prev;
            }
            const pathStr = pathArray.join('.');
            const depth = pathArray.filter((p) => typeof p === 'string').length;

            return (error) => {
              const spanEndNs = process.hrtime.bigint();
              const durationMs = Number(spanEndNs - spanStartNs) / 1_000_000;
              const endOffsetMs = startOffsetMs + durationMs;

              // Check if the resolver attached custom span metadata on context
              const existingMeta = (contextValue as any).__spanMeta?.[pathStr];

              const span: ResolverTraceSpan = {
                id: `span-${contextValue.traces.length + 1}`,
                path: pathStr,
                parentType: info.parentType.name,
                fieldName: info.fieldName,
                returnType: info.returnType.toString(),
                startOffsetMs: Number(startOffsetMs.toFixed(2)),
                durationMs: Number(durationMs.toFixed(2)),
                endOffsetMs: Number(endOffsetMs.toFixed(2)),
                depth,
                batchedWithDataLoader:
                  existingMeta?.batchedWithDataLoader ??
                  Boolean(contextValue.chaosConfig?.useDataLoader),
                dbQueriesTriggered: existingMeta?.dbQueriesTriggered ?? 1,
                chaosInjected: existingMeta?.chaosInjected,
                status: error
                  ? 'ERROR'
                  : durationMs > 45
                    ? 'SLOW'
                    : 'OK',
              };

              contextValue.traces.push(span);
            };
          },
        };
      },

      async willSendResponse(requestContext) {
        const { response, contextValue } = requestContext;
        if (
          response.body.kind === 'single' &&
          contextValue.traces &&
          !requestContext.request.query?.includes('__schema')
        ) {
          const totalDurationMs =
            Number(
              process.hrtime.bigint() -
                (contextValue.requestStartNs || process.hrtime.bigint()),
            ) / 1_000_000;

          const sortedTraces = [...contextValue.traces].sort(
            (a, b) => a.startOffsetMs - b.startOffsetMs,
          );

          response.body.singleResult.extensions = {
            ...response.body.singleResult.extensions,
            sandboxTelemetry: {
              timestamp: new Date().toISOString(),
              totalDurationMs: Number(totalDurationMs.toFixed(2)),
              dbQueryCount: contextValue.dbQueryCount || sortedTraces.reduce((acc, s) => acc + s.dbQueriesTriggered, 0),
              dataloaderBatches: contextValue.dataloaderBatches || 0,
              chaosEventsTriggered: contextValue.chaosEventsTriggered || 0,
              chaosConfig: contextValue.chaosConfig,
              astAnalysis: contextValue.astAnalysis,
              resolverWatermarkCount: sortedTraces.length,
              traces: sortedTraces,
            },
          };
        }
      },
    };
  }
}
