import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { CART_ENVIRONMENT, type CartEnvironment } from './common/environment';
import { configureHttpApp } from './common/http';

export const bootstrap = async (): Promise<void> => {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureHttpApp(app);
  app.enableShutdownHooks();
  await app.listen(app.get<CartEnvironment>(CART_ENVIRONMENT).PORT);
};

if (require.main === module) void bootstrap();
