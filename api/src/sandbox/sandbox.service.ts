import { Injectable } from '@nestjs/common';
import DataLoader from 'dataloader';
import {
  Customer,
  FraudRiskScore,
  Merchant,
  Order,
  OrderItem,
  Product,
  Review,
  ShipmentTelemetry,
  WarehouseNode,
} from './sandbox.models';
import { ChaosConfig, SandboxRequestContext } from '../plugins/tracing-chaos.plugin';
import { GraphQLError } from 'graphql';

const CUSTOMERS: Customer[] = [
  { id: 'cust-1', name: 'Aarav Kulkarni', email: 'aarav@hyperion.dev', vipTier: 'PLATINUM', region: 'ap-south-1' },
  { id: 'cust-2', name: 'Elena Rostova', email: 'elena@nebula.io', vipTier: 'ENTERPRISE', region: 'eu-central-1' },
  { id: 'cust-3', name: 'Marcus Vance', email: 'mvance@chronos.cloud', vipTier: 'GOLD', region: 'us-east-1' },
  { id: 'cust-4', name: 'Priya Nair', email: 'priya@vertex-ai.in', vipTier: 'PLATINUM', region: 'ap-south-1' },
  { id: 'cust-5', name: 'Kenji Takahashi', email: 'kenji@kuroshio.jp', vipTier: 'ENTERPRISE', region: 'ap-northeast-1' },
  { id: 'cust-6', name: 'Sofia Lindqvist', email: 'sofia@nordicmesh.se', vipTier: 'GOLD', region: 'eu-north-1' },
];

const MERCHANTS: Merchant[] = [
  { id: 'merch-1', name: 'TensorCore Hardware Labs', tier: 'VERIFIED_OEM', slaUptimePct: 99.98, primaryRegion: 'us-west-2' },
  { id: 'merch-2', name: 'Aetherius Optics & Silicon', tier: 'PREMIER', slaUptimePct: 99.94, primaryRegion: 'eu-central-1' },
  { id: 'merch-3', name: 'Kavach Cloud Appliances', tier: 'VERIFIED_OEM', slaUptimePct: 99.99, primaryRegion: 'ap-south-1' },
];

const PRODUCTS: Product[] = [
  { id: 'prod-101', sku: 'NV-H200-NODE', name: 'HGX Compute Blade 141GB', category: 'AI Infrastructure', priceUsd: 32400, sellerId: 'merch-1' },
  { id: 'prod-102', sku: 'OPT-800G-QSFP', name: '800G Silicon Photonics Transceiver', category: 'Networking', priceUsd: 1850, sellerId: 'merch-2' },
  { id: 'prod-103', sku: 'KV-HSM-ZERO', name: 'FIPS 140-3 Hardware Security Module', category: 'Security', priceUsd: 8900, sellerId: 'merch-3' },
  { id: 'prod-104', sku: 'NV-NVLINK-SW', name: 'NVLink 72-Port Fabric Switch', category: 'Networking', priceUsd: 14200, sellerId: 'merch-1' },
  { id: 'prod-105', sku: 'AETH-CXL-MEM', name: 'CXL 3.0 Memory Expander 512GB', category: 'Memory', priceUsd: 4600, sellerId: 'merch-2' },
  { id: 'prod-106', sku: 'KV-EDGE-RACK', name: 'ruggedized Micro-Datacenter Pod', category: 'Edge Compute', priceUsd: 19500, sellerId: 'merch-3' },
];

const ORDERS: Order[] = [
  { id: 'ord-9001', orderNumber: 'ORD-2026-9001', status: 'DISPATCHED', totalUsd: 68500, createdAt: '2026-10-31T08:12:00Z', customerId: 'cust-1' },
  { id: 'ord-9002', orderNumber: 'ORD-2026-9002', status: 'PROCESSING', totalUsd: 26800, createdAt: '2026-10-31T08:25:00Z', customerId: 'cust-2' },
  { id: 'ord-9003', orderNumber: 'ORD-2026-9003', status: 'IN_TRANSIT', totalUsd: 51900, createdAt: '2026-10-31T08:40:00Z', customerId: 'cust-3' },
  { id: 'ord-9004', orderNumber: 'ORD-2026-9004', status: 'DELIVERED', totalUsd: 23100, createdAt: '2026-10-31T09:05:00Z', customerId: 'cust-4' },
  { id: 'ord-9005', orderNumber: 'ORD-2026-9005', status: 'DISPATCHED', totalUsd: 41300, createdAt: '2026-10-31T09:18:00Z', customerId: 'cust-5' },
  { id: 'ord-9006', orderNumber: 'ORD-2026-9006', status: 'PROCESSING', totalUsd: 15350, createdAt: '2026-10-31T09:42:00Z', customerId: 'cust-6' },
  { id: 'ord-9007', orderNumber: 'ORD-2026-9007', status: 'IN_TRANSIT', totalUsd: 37000, createdAt: '2026-10-31T09:58:00Z', customerId: 'cust-1' },
  { id: 'ord-9008', orderNumber: 'ORD-2026-9008', status: 'DISPATCHED', totalUsd: 28400, createdAt: '2026-10-31T10:11:00Z', customerId: 'cust-4' },
];

const ORDER_ITEMS: OrderItem[] = [
  { id: 'item-1', orderId: 'ord-9001', productId: 'prod-101', quantity: 2, unitPriceUsd: 32400 },
  { id: 'item-2', orderId: 'ord-9001', productId: 'prod-102', quantity: 2, unitPriceUsd: 1850 },
  { id: 'item-3', orderId: 'ord-9002', productId: 'prod-103', quantity: 2, unitPriceUsd: 8900 },
  { id: 'item-4', orderId: 'ord-9002', productId: 'prod-105', quantity: 2, unitPriceUsd: 4600 },
  { id: 'item-5', orderId: 'ord-9003', productId: 'prod-101', quantity: 1, unitPriceUsd: 32400 },
  { id: 'item-6', orderId: 'ord-9003', productId: 'prod-106', quantity: 1, unitPriceUsd: 19500 },
  { id: 'item-7', orderId: 'ord-9004', productId: 'prod-104', quantity: 1, unitPriceUsd: 14200 },
  { id: 'item-8', orderId: 'ord-9004', productId: 'prod-103', quantity: 1, unitPriceUsd: 8900 },
  { id: 'item-9', orderId: 'ord-9005', productId: 'prod-101', quantity: 1, unitPriceUsd: 32400 },
  { id: 'item-10', orderId: 'ord-9005', productId: 'prod-103', quantity: 1, unitPriceUsd: 8900 },
  { id: 'item-11', orderId: 'ord-9006', productId: 'prod-102', quantity: 5, unitPriceUsd: 1850 },
  { id: 'item-12', orderId: 'ord-9006', productId: 'prod-105', quantity: 1, unitPriceUsd: 4600 },
  { id: 'item-13', orderId: 'ord-9007', productId: 'prod-101', quantity: 1, unitPriceUsd: 32400 },
  { id: 'item-14', orderId: 'ord-9007', productId: 'prod-105', quantity: 1, unitPriceUsd: 4600 },
  { id: 'item-15', orderId: 'ord-9008', productId: 'prod-104', quantity: 2, unitPriceUsd: 14200 },
];

const REVIEWS: Review[] = [
  { id: 'rev-1', productId: 'prod-101', authorName: 'Dr. S. Subramanian', rating: 5, comment: 'Sustained 94% HBM3e bandwidth under 64-node training load.', sentimentScore: 0.98 },
  { id: 'rev-2', productId: 'prod-101', authorName: 'L. Chen (Principal SRE)', rating: 5, comment: 'Zero thermal throttling with liquid manifold.', sentimentScore: 0.94 },
  { id: 'rev-3', productId: 'prod-102', authorName: 'K. Varma', rating: 4, comment: 'Ultra-low BER, firmware 4.2 fixed link flap.', sentimentScore: 0.85 },
  { id: 'rev-4', productId: 'prod-103', authorName: 'SecOps Lead @ FinCore', rating: 5, comment: 'Sub-millisecond PKCS#11 signing throughput.', sentimentScore: 0.96 },
  { id: 'rev-5', productId: 'prod-104', authorName: 'HPC Architect', rating: 5, comment: 'Cut collective all-reduce tail latency by 41%.', sentimentScore: 0.95 },
  { id: 'rev-6', productId: 'prod-105', authorName: 'In-Memory DB Team', rating: 4, comment: 'Seamless NUMA tiering over PCIe Gen5.', sentimentScore: 0.89 },
  { id: 'rev-7', productId: 'prod-106', authorName: 'Telco Edge Ops', rating: 5, comment: 'Survived 48C ambient desert deployment.', sentimentScore: 0.93 },
];

const WAREHOUSES: Record<string, WarehouseNode[]> = {
  'prod-101': [
    { id: 'wh-1', regionCode: 'ap-south-1', city: 'Pune Hub', stockAvailable: 18, dispatchLatencyMs: 4.2 },
    { id: 'wh-2', regionCode: 'eu-central-1', city: 'Frankfurt Hub', stockAvailable: 9, dispatchLatencyMs: 6.8 },
  ],
  'prod-102': [
    { id: 'wh-3', regionCode: 'us-west-2', city: 'Oregon Hub', stockAvailable: 240, dispatchLatencyMs: 3.1 },
    { id: 'wh-1', regionCode: 'ap-south-1', city: 'Pune Hub', stockAvailable: 115, dispatchLatencyMs: 4.0 },
  ],
  'prod-103': [
    { id: 'wh-1', regionCode: 'ap-south-1', city: 'Pune Hub', stockAvailable: 34, dispatchLatencyMs: 3.5 },
  ],
  'prod-104': [
    { id: 'wh-2', regionCode: 'eu-central-1', city: 'Frankfurt Hub', stockAvailable: 14, dispatchLatencyMs: 5.4 },
  ],
  'prod-105': [
    { id: 'wh-3', regionCode: 'us-west-2', city: 'Oregon Hub', stockAvailable: 64, dispatchLatencyMs: 4.1 },
  ],
  'prod-106': [
    { id: 'wh-1', regionCode: 'ap-south-1', city: 'Pune Hub', stockAvailable: 7, dispatchLatencyMs: 5.9 },
  ],
};

@Injectable()
export class SandboxService {
  private defaultChaosConfig: ChaosConfig = {
    enabled: false,
    mode: 'NONE',
    latencyMs: 0,
    jitterMs: 0,
    failureRate: 0,
    targetResolvers: [],
    useDataLoader: false,
    maxComplexity: 250,
    maxDepth: 8,
  };

  getDefaultChaosConfig(): ChaosConfig {
    return { ...this.defaultChaosConfig };
  }

  updateDefaultChaosConfig(partial: Partial<ChaosConfig>): ChaosConfig {
    this.defaultChaosConfig = {
      ...this.defaultChaosConfig,
      ...partial,
    };
    return this.getDefaultChaosConfig();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private recordSpanMeta(
    ctx: SandboxRequestContext,
    pathStr: string,
    meta: {
      batchedWithDataLoader: boolean;
      dbQueriesTriggered: number;
      chaosInjected?: {
        type: 'LATENCY' | 'ERROR' | 'JITTER';
        addedLatencyMs: number;
        errorMessage?: string;
      };
    },
  ) {
    if (!ctx) return;
    (ctx as any).__spanMeta = (ctx as any).__spanMeta || {};
    (ctx as any).__spanMeta[pathStr] = meta;
  }

  async simulateResolverWork(
    ctx: SandboxRequestContext,
    resolverName: string,
    pathStr: string,
    baseDbMs: number,
    batched: boolean,
  ): Promise<void> {
    const cfg = ctx?.chaosConfig || this.defaultChaosConfig;
    let addedChaosLatency = 0;
    let chaosType: 'LATENCY' | 'ERROR' | 'JITTER' | undefined;

    const isTarget =
      !cfg.targetResolvers ||
      cfg.targetResolvers.length === 0 ||
      cfg.targetResolvers.includes(resolverName);

    if (cfg.enabled && isTarget) {
      if (cfg.mode === 'LATENCY_SPIKE' && cfg.latencyMs > 0) {
        addedChaosLatency = cfg.latencyMs;
        chaosType = 'LATENCY';
      } else if (cfg.mode === 'PACKET_JITTER') {
        addedChaosLatency = Math.round(
          (cfg.latencyMs || 25) + Math.random() * (cfg.jitterMs || 85),
        );
        chaosType = 'JITTER';
      } else if (cfg.mode === 'DB_POOL_EXHAUSTION' && !batched) {
        // Unbatched N+1 queries suffer exponential contention under pool exhaustion
        const contentionPenalty = Math.min(220, (ctx.dbQueryCount || 1) * 9);
        addedChaosLatency = contentionPenalty;
        chaosType = 'LATENCY';
      }

      if (addedChaosLatency > 0) {
        ctx.chaosEventsTriggered = (ctx.chaosEventsTriggered || 0) + 1;
        await this.sleep(addedChaosLatency);
      }

      if (
        (cfg.mode === 'PARTIAL_FAILURE' || cfg.failureRate > 0) &&
        Math.random() < (cfg.failureRate || 0.25)
      ) {
        ctx.chaosEventsTriggered = (ctx.chaosEventsTriggered || 0) + 1;
        const errMsg = `[ChaosEngine:${cfg.mode}] Upstream microservice timeout in resolver "${resolverName}" at path "${pathStr}"`;
        this.recordSpanMeta(ctx, pathStr, {
          batchedWithDataLoader: batched,
          dbQueriesTriggered: batched ? 0 : 1,
          chaosInjected: {
            type: 'ERROR',
            addedLatencyMs: addedChaosLatency,
            errorMessage: errMsg,
          },
        });
        throw new GraphQLError(errMsg, {
          extensions: {
            code: 'CHAOS_INJECTED_PARTIAL_FAILURE',
            resolver: resolverName,
            path: pathStr,
          },
        });
      }
    }

    await this.sleep(baseDbMs);

    if (!batched && ctx) {
      ctx.dbQueryCount = (ctx.dbQueryCount || 0) + 1;
    }

    this.recordSpanMeta(ctx, pathStr, {
      batchedWithDataLoader: batched,
      dbQueriesTriggered: batched ? 0 : 1,
      chaosInjected: chaosType
        ? {
            type: chaosType,
            addedLatencyMs: addedChaosLatency,
          }
        : undefined,
    });
  }

  getLoaders(ctx: SandboxRequestContext) {
    if (!(ctx as any).__loaders) {
      (ctx as any).__loaders = {
        customerLoader: new DataLoader<string, Customer>(async (ids) => {
          ctx.dbQueryCount = (ctx.dbQueryCount || 0) + 1;
          ctx.dataloaderBatches = (ctx.dataloaderBatches || 0) + 1;
          await this.sleep(7);
          return ids.map(
            (id) => CUSTOMERS.find((c) => c.id === id) || CUSTOMERS[0],
          );
        }),
        itemsByOrderLoader: new DataLoader<string, OrderItem[]>(
          async (orderIds) => {
            ctx.dbQueryCount = (ctx.dbQueryCount || 0) + 1;
            ctx.dataloaderBatches = (ctx.dataloaderBatches || 0) + 1;
            await this.sleep(8);
            return orderIds.map((oid) =>
              ORDER_ITEMS.filter((item) => item.orderId === oid),
            );
          },
        ),
        productLoader: new DataLoader<string, Product>(async (prodIds) => {
          ctx.dbQueryCount = (ctx.dbQueryCount || 0) + 1;
          ctx.dataloaderBatches = (ctx.dataloaderBatches || 0) + 1;
          await this.sleep(6);
          return prodIds.map(
            (pid) => PRODUCTS.find((p) => p.id === pid) || PRODUCTS[0],
          );
        }),
        merchantLoader: new DataLoader<string, Merchant>(async (sellerIds) => {
          ctx.dbQueryCount = (ctx.dbQueryCount || 0) + 1;
          ctx.dataloaderBatches = (ctx.dataloaderBatches || 0) + 1;
          await this.sleep(5);
          return sellerIds.map(
            (sid) => MERCHANTS.find((m) => m.id === sid) || MERCHANTS[0],
          );
        }),
        reviewsByProductLoader: new DataLoader<string, Review[]>(
          async (prodIds) => {
            ctx.dbQueryCount = (ctx.dbQueryCount || 0) + 1;
            ctx.dataloaderBatches = (ctx.dataloaderBatches || 0) + 1;
            await this.sleep(6);
            return prodIds.map((pid) =>
              REVIEWS.filter((r) => r.productId === pid),
            );
          },
        ),
        warehousesByProductLoader: new DataLoader<string, WarehouseNode[]>(
          async (prodIds) => {
            ctx.dbQueryCount = (ctx.dbQueryCount || 0) + 1;
            ctx.dataloaderBatches = (ctx.dataloaderBatches || 0) + 1;
            await this.sleep(6);
            return prodIds.map((pid) => WAREHOUSES[pid] || WAREHOUSES['prod-101']);
          },
        ),
      };
    }
    return (ctx as any).__loaders;
  }

  async findOrders(limit: number, ctx: SandboxRequestContext): Promise<Order[]> {
    await this.simulateResolverWork(ctx, 'orders', 'orders', 9, false);
    return ORDERS.slice(0, Math.max(1, Math.min(limit, ORDERS.length)));
  }

  async findCustomerForOrder(
    order: Order,
    pathStr: string,
    ctx: SandboxRequestContext,
  ): Promise<Customer> {
    const useBatch = Boolean(ctx?.chaosConfig?.useDataLoader);
    await this.simulateResolverWork(
      ctx,
      'customer',
      pathStr,
      useBatch ? 1 : 12,
      useBatch,
    );
    if (useBatch) {
      return this.getLoaders(ctx).customerLoader.load(order.customerId);
    }
    return (
      CUSTOMERS.find((c) => c.id === order.customerId) || CUSTOMERS[0]
    );
  }

  async findItemsForOrder(
    order: Order,
    pathStr: string,
    ctx: SandboxRequestContext,
  ): Promise<OrderItem[]> {
    const useBatch = Boolean(ctx?.chaosConfig?.useDataLoader);
    await this.simulateResolverWork(
      ctx,
      'items',
      pathStr,
      useBatch ? 1 : 14,
      useBatch,
    );
    if (useBatch) {
      return this.getLoaders(ctx).itemsByOrderLoader.load(order.id);
    }
    return ORDER_ITEMS.filter((i) => i.orderId === order.id);
  }

  async findShipmentForOrder(
    order: Order,
    pathStr: string,
    ctx: SandboxRequestContext,
  ): Promise<ShipmentTelemetry> {
    const useBatch = Boolean(ctx?.chaosConfig?.useDataLoader);
    await this.simulateResolverWork(
      ctx,
      'shippingTrack',
      pathStr,
      useBatch ? 2 : 15,
      useBatch,
    );
    return {
      id: `ship-${order.id}`,
      orderId: order.id,
      carrier: 'HyperLoop Air Cargo',
      trackingCode: `HL-${order.id.toUpperCase()}-IN`,
      status: order.status,
      currentHub: 'Pune Lohegaon Air Cargo Terminal',
    };
  }

  async findFraudScoreForOrder(
    order: Order,
    pathStr: string,
    ctx: SandboxRequestContext,
  ): Promise<FraudRiskScore> {
    const useBatch = Boolean(ctx?.chaosConfig?.useDataLoader);
    await this.simulateResolverWork(
      ctx,
      'fraudAnalysis',
      pathStr,
      useBatch ? 2 : 18,
      useBatch,
    );
    return {
      id: `fraud-${order.id}`,
      orderId: order.id,
      riskProbability: Number(((order.totalUsd % 17) / 100).toFixed(3)),
      decision: 'ALLOW_VERIFIED',
      modelVersion: 'xgboost-risk-v4.2',
    };
  }

  async findProductForItem(
    item: OrderItem,
    pathStr: string,
    ctx: SandboxRequestContext,
  ): Promise<Product> {
    const useBatch = Boolean(ctx?.chaosConfig?.useDataLoader);
    await this.simulateResolverWork(
      ctx,
      'product',
      pathStr,
      useBatch ? 1 : 13,
      useBatch,
    );
    if (useBatch) {
      return this.getLoaders(ctx).productLoader.load(item.productId);
    }
    return PRODUCTS.find((p) => p.id === item.productId) || PRODUCTS[0];
  }

  async findSellerForProduct(
    product: Product,
    pathStr: string,
    ctx: SandboxRequestContext,
  ): Promise<Merchant> {
    const useBatch = Boolean(ctx?.chaosConfig?.useDataLoader);
    await this.simulateResolverWork(
      ctx,
      'seller',
      pathStr,
      useBatch ? 1 : 11,
      useBatch,
    );
    if (useBatch) {
      return this.getLoaders(ctx).merchantLoader.load(product.sellerId);
    }
    return MERCHANTS.find((m) => m.id === product.sellerId) || MERCHANTS[0];
  }

  async findReviewsForProduct(
    product: Product,
    pathStr: string,
    ctx: SandboxRequestContext,
  ): Promise<Review[]> {
    const useBatch = Boolean(ctx?.chaosConfig?.useDataLoader);
    await this.simulateResolverWork(
      ctx,
      'reviews',
      pathStr,
      useBatch ? 1 : 14,
      useBatch,
    );
    if (useBatch) {
      return this.getLoaders(ctx).reviewsByProductLoader.load(product.id);
    }
    return REVIEWS.filter((r) => r.productId === product.id);
  }

  async findWarehousesForProduct(
    product: Product,
    pathStr: string,
    ctx: SandboxRequestContext,
  ): Promise<WarehouseNode[]> {
    const useBatch = Boolean(ctx?.chaosConfig?.useDataLoader);
    await this.simulateResolverWork(
      ctx,
      'warehouses',
      pathStr,
      useBatch ? 1 : 12,
      useBatch,
    );
    if (useBatch) {
      return this.getLoaders(ctx).warehousesByProductLoader.load(product.id);
    }
    return WAREHOUSES[product.id] || WAREHOUSES['prod-101'];
  }
}
