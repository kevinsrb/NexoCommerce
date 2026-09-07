import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { AUTH_ENVIRONMENT, type AuthEnvironment } from './common/environment';
import { configureHttpApp } from './common/http';

export const bootstrap = async (): Promise<void> => {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureHttpApp(app);
  app.enableShutdownHooks();
  await app.listen(app.get<AuthEnvironment>(AUTH_ENVIRONMENT).PORT);
};

if (require.main === module) void bootstrap();
