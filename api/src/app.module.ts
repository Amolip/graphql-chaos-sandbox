import { Module, Global } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { SandboxService } from './sandbox/sandbox.service';
import {
  OrderItemResolver,
  OrderResolver,
  ProductResolver,
} from './sandbox/sandbox.resolver';
import { SandboxController } from './sandbox/sandbox.controller';
import {
  ChaosConfig,
  TracingChaosApolloPlugin,
} from './plugins/tracing-chaos.plugin';

@Global()
@Module({
  providers: [SandboxService],
  exports: [SandboxService],
})
export class SandboxCoreModule {}

@Module({
  imports: [
    SandboxCoreModule,
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      imports: [SandboxCoreModule],
      inject: [SandboxService],
      useFactory: (sandboxService: SandboxService) => ({
        autoSchemaFile: true,
        sortSchema: true,
        playground: true,
        introspection: true,
        context: ({ req }) => {
          const baseCfg = sandboxService.getDefaultChaosConfig();
          let headerCfg: Partial<ChaosConfig> = {};

          const rawChaosHeader = req?.headers?.['x-chaos-config'];
          if (typeof rawChaosHeader === 'string') {
            try {
              headerCfg = JSON.parse(rawChaosHeader);
            } catch {
              // ignore malformed header
            }
          }

          const chaosConfig: ChaosConfig = {
            ...baseCfg,
            ...headerCfg,
          };

          return {
            req,
            chaosConfig,
            traces: [],
            dbQueryCount: 0,
            dataloaderBatches: 0,
            chaosEventsTriggered: 0,
          };
        },
      }),
    }),
  ],
  controllers: [SandboxController],
  providers: [
    OrderResolver,
    OrderItemResolver,
    ProductResolver,
    TracingChaosApolloPlugin,
  ],
})
export class AppModule {}
