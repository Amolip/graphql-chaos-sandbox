import { ObjectType, Field, ID, Int, Float } from '@nestjs/graphql';

@ObjectType()
export class WarehouseNode {
  @Field(() => ID)
  id: string;

  @Field()
  regionCode: string;

  @Field()
  city: string;

  @Field(() => Int)
  stockAvailable: number;

  @Field(() => Float)
  dispatchLatencyMs: number;
}

@ObjectType()
export class Review {
  @Field(() => ID)
  id: string;

  @Field()
  productId: string;

  @Field()
  authorName: string;

  @Field(() => Int)
  rating: number;

  @Field()
  comment: string;

  @Field(() => Float)
  sentimentScore: number;
}

@ObjectType()
export class Merchant {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field()
  tier: string;

  @Field(() => Float)
  slaUptimePct: number;

  @Field()
  primaryRegion: string;
}

@ObjectType()
export class Product {
  @Field(() => ID)
  id: string;

  @Field()
  sku: string;

  @Field()
  name: string;

  @Field()
  category: string;

  @Field(() => Float)
  priceUsd: number;

  @Field()
  sellerId: string;

  @Field(() => Merchant)
  seller?: Merchant;

  @Field(() => [Review])
  reviews?: Review[];

  @Field(() => [WarehouseNode])
  warehouses?: WarehouseNode[];
}

@ObjectType()
export class OrderItem {
  @Field(() => ID)
  id: string;

  @Field()
  orderId: string;

  @Field()
  productId: string;

  @Field(() => Int)
  quantity: number;

  @Field(() => Float)
  unitPriceUsd: number;

  @Field(() => Product)
  product?: Product;
}

@ObjectType()
export class Customer {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field()
  email: string;

  @Field()
  vipTier: string;

  @Field()
  region: string;
}

@ObjectType()
export class ShipmentTelemetry {
  @Field(() => ID)
  id: string;

  @Field()
  orderId: string;

  @Field()
  carrier: string;

  @Field()
  trackingCode: string;

  @Field()
  status: string;

  @Field()
  currentHub: string;
}

@ObjectType()
export class FraudRiskScore {
  @Field(() => ID)
  id: string;

  @Field()
  orderId: string;

  @Field(() => Float)
  riskProbability: number;

  @Field()
  decision: string;

  @Field()
  modelVersion: string;
}

@ObjectType()
export class Order {
  @Field(() => ID)
  id: string;

  @Field()
  orderNumber: string;

  @Field()
  status: string;

  @Field(() => Float)
  totalUsd: number;

  @Field()
  createdAt: string;

  @Field()
  customerId: string;

  @Field(() => Customer)
  customer?: Customer;

  @Field(() => [OrderItem])
  items?: OrderItem[];

  @Field(() => ShipmentTelemetry)
  shippingTrack?: ShipmentTelemetry;

  @Field(() => FraudRiskScore, { nullable: true })
  fraudAnalysis?: FraudRiskScore;
}
