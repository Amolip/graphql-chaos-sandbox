import {
  Resolver,
  Query,
  Args,
  Int,
  ResolveField,
  Parent,
  Context,
  Info,
} from '@nestjs/graphql';
import { GraphQLResolveInfo } from 'graphql';
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
import { SandboxService } from './sandbox.service';
import { SandboxRequestContext } from '../plugins/tracing-chaos.plugin';

function buildPath(info: GraphQLResolveInfo): string {
  const pathArray: (string | number)[] = [];
  let cur: any = info.path;
  while (cur) {
    pathArray.unshift(cur.key);
    cur = cur.prev;
  }
  return pathArray.join('.');
}

@Resolver(() => Order)
export class OrderResolver {
  constructor(private readonly sandboxService: SandboxService) {}

  @Query(() => [Order], {
    name: 'orders',
    description:
      'Fetch distributed commerce orders with nested N+1 vs DataLoader telemetry.',
  })
  async getOrders(
    @Args('limit', { type: () => Int, defaultValue: 5 }) limit: number,
    @Context() ctx: SandboxRequestContext,
  ): Promise<Order[]> {
    return this.sandboxService.findOrders(limit, ctx);
  }

  @ResolveField(() => Customer)
  async customer(
    @Parent() order: Order,
    @Context() ctx: SandboxRequestContext,
    @Info() info: GraphQLResolveInfo,
  ): Promise<Customer> {
    return this.sandboxService.findCustomerForOrder(
      order,
      buildPath(info),
      ctx,
    );
  }

  @ResolveField(() => [OrderItem])
  async items(
    @Parent() order: Order,
    @Context() ctx: SandboxRequestContext,
    @Info() info: GraphQLResolveInfo,
  ): Promise<OrderItem[]> {
    return this.sandboxService.findItemsForOrder(order, buildPath(info), ctx);
  }

  @ResolveField(() => ShipmentTelemetry)
  async shippingTrack(
    @Parent() order: Order,
    @Context() ctx: SandboxRequestContext,
    @Info() info: GraphQLResolveInfo,
  ): Promise<ShipmentTelemetry> {
    return this.sandboxService.findShipmentForOrder(
      order,
      buildPath(info),
      ctx,
    );
  }

  @ResolveField(() => FraudRiskScore, { nullable: true })
  async fraudAnalysis(
    @Parent() order: Order,
    @Context() ctx: SandboxRequestContext,
    @Info() info: GraphQLResolveInfo,
  ): Promise<FraudRiskScore> {
    return this.sandboxService.findFraudScoreForOrder(
      order,
      buildPath(info),
      ctx,
    );
  }
}

@Resolver(() => OrderItem)
export class OrderItemResolver {
  constructor(private readonly sandboxService: SandboxService) {}

  @ResolveField(() => Product)
  async product(
    @Parent() item: OrderItem,
    @Context() ctx: SandboxRequestContext,
    @Info() info: GraphQLResolveInfo,
  ): Promise<Product> {
    return this.sandboxService.findProductForItem(item, buildPath(info), ctx);
  }
}

@Resolver(() => Product)
export class ProductResolver {
  constructor(private readonly sandboxService: SandboxService) {}

  @ResolveField(() => Merchant)
  async seller(
    @Parent() product: Product,
    @Context() ctx: SandboxRequestContext,
    @Info() info: GraphQLResolveInfo,
  ): Promise<Merchant> {
    return this.sandboxService.findSellerForProduct(
      product,
      buildPath(info),
      ctx,
    );
  }

  @ResolveField(() => [Review])
  async reviews(
    @Parent() product: Product,
    @Context() ctx: SandboxRequestContext,
    @Info() info: GraphQLResolveInfo,
  ): Promise<Review[]> {
    return this.sandboxService.findReviewsForProduct(
      product,
      buildPath(info),
      ctx,
    );
  }

  @ResolveField(() => [WarehouseNode])
  async warehouses(
    @Parent() product: Product,
    @Context() ctx: SandboxRequestContext,
    @Info() info: GraphQLResolveInfo,
  ): Promise<WarehouseNode[]> {
    return this.sandboxService.findWarehousesForProduct(
      product,
      buildPath(info),
      ctx,
    );
  }
}
