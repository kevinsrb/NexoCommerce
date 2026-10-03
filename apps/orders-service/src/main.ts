import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ORDERS_ENVIRONMENT } from './common/environment';
import { configureHttpApp } from './common/http';
import { type OrdersEnvironment } from '@nexo/config';

export const bootstrap = async (): Promise<void> => {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureHttpApp(app);
  app.enableShutdownHooks();
  await app.listen(app.get<OrdersEnvironment>(ORDERS_ENVIRONMENT).PORT);
};

if (require.main === module) void bootstrap();
