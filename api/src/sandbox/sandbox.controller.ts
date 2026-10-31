import { Body, Controller, Get, Post } from '@nestjs/common';
import { SandboxService } from './sandbox.service';
import { AstComplexityAnalyzer } from '../ast/ast-complexity.analyzer';
import { ChaosConfig } from '../plugins/tracing-chaos.plugin';

@Controller('api/sandbox')
export class SandboxController {
  constructor(private readonly sandboxService: SandboxService) {}

  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      service: 'graphql-chaos-sandbox-api',
      apolloPlugin: 'TracingChaosApolloPlugin',
      defaultChaosConfig: this.sandboxService.getDefaultChaosConfig(),
    };
  }

  @Post('analyze-ast')
  analyzeAst(
    @Body()
    body: {
      query: string;
      maxComplexity?: number;
      maxDepth?: number;
    },
  ) {
    return AstComplexityAnalyzer.analyze(
      body.query || '',
      body.maxComplexity ?? 250,
      body.maxDepth ?? 8,
    );
  }

  @Post('chaos-config')
  updateChaosConfig(@Body() body: Partial<ChaosConfig>) {
    return this.sandboxService.updateDefaultChaosConfig(body);
  }

  @Post('traffic-spike')
  async simulateTrafficSpike(
    @Body()
    body: {
      concurrency: number;
      totalRequests: number;
      useDataLoader: boolean;
      chaosMode: ChaosConfig['mode'];
      latencyMs: number;
      failureRate: number;
      queryComplexity: number;
    },
  ) {
    const concurrency = Math.max(1, Math.min(body.concurrency || 25, 200));
    const totalRequests = Math.max(5, Math.min(body.totalRequests || 60, 500));
    const useDataLoader = Boolean(body.useDataLoader);
    const chaosMode = body.chaosMode || 'NONE';
    const latencyMs = body.latencyMs ?? 0;
    const failureRate = body.failureRate ?? 0;
    const complexity = body.queryComplexity || 68;

    const buckets: {
      requestIndex: number;
      wave: number;
      durationMs: number;
      dbQueries: number;
      status: '200_OK' | '206_PARTIAL' | '429_COMPLEXITY' | '503_CHAOS';
    }[] = [];

    const totalWaves = Math.ceil(totalRequests / concurrency);

    for (let i = 0; i < totalRequests; i++) {
      const wave = Math.floor(i / concurrency) + 1;
      const waveLoadFactor = 1 + (concurrency / 45) * (useDataLoader ? 0.22 : 1.15);

      const baseMs = useDataLoader
        ? 18 + (complexity / 25) * 2.4
        : 74 + (complexity / 15) * 9.5;

      const chaosPenalty =
        chaosMode === 'LATENCY_SPIKE'
          ? latencyMs
          : chaosMode === 'PACKET_JITTER'
            ? latencyMs * 0.5 + Math.random() * 90
            : chaosMode === 'DB_POOL_EXHAUSTION' && !useDataLoader
              ? concurrency * 4.2
              : 0;

      const jitter = (Math.sin(i * 1.7) + 1.2) * (useDataLoader ? 4.5 : 18.5);
      const durationMs = Number(
        (baseMs * waveLoadFactor + chaosPenalty + jitter).toFixed(1),
      );

      const dbQueries = useDataLoader
        ? 5
        : Math.max(12, Math.round(complexity * 0.42));

      let status: '200_OK' | '206_PARTIAL' | '429_COMPLEXITY' | '503_CHAOS' =
        '200_OK';
      if (
        (chaosMode === 'PARTIAL_FAILURE' || failureRate > 0) &&
        ((i * 17) % 100) / 100 < (failureRate || 0.25)
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

    const sortedLatencies = [...buckets]
      .map((b) => b.durationMs)
      .sort((a, b) => a - b);

    const p50 =
      sortedLatencies[Math.floor(sortedLatencies.length * 0.5)] || 0;
    const p95 =
      sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] || 0;
    const p99 =
      sortedLatencies[Math.floor(sortedLatencies.length * 0.99)] || 0;

    const totalDbQueries = buckets.reduce((acc, b) => acc + b.dbQueries, 0);
    const errorCount = buckets.filter((b) => b.status !== '200_OK').length;
    const avgLatency =
      sortedLatencies.reduce((acc, v) => acc + v, 0) / sortedLatencies.length;
    const rpsThroughput = Number(
      ((concurrency * 1000) / Math.max(10, avgLatency)).toFixed(1),
    );

    return {
      concurrency,
      totalRequests,
      totalWaves,
      useDataLoader,
      chaosMode,
      metrics: {
        p50Ms: Number(p50.toFixed(1)),
        p95Ms: Number(p95.toFixed(1)),
        p99Ms: Number(p99.toFixed(1)),
        avgMs: Number(avgLatency.toFixed(1)),
        rpsThroughput,
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
