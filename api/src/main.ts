import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-chaos-config'],
  });
  const port = process.env.PORT || 3333;
  await app.listen(port);
  console.log(
    `[GraphQL Chaos Sandbox API] Listening on http://localhost:${port}/graphql`,
  );
}
bootstrap();
