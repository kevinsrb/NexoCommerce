import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { parseBaseEnvironment } from '@nexo/config';
import { createLogger } from '@nexo/logger';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http/http-exception.filter';
import { RequestLoggingInterceptor } from './common/http/request-logging.interceptor';
import { requestIdMiddleware } from './common/http/request-id.middleware';

const logger = createLogger('api-gateway');

export const configureHttpApp = (app: NestExpressApplication): void => {
  app.use(helmet());
  app.enableCors();
  app.use(requestIdMiddleware);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalInterceptors(new RequestLoggingInterceptor(logger));
  app.useGlobalFilters(new HttpExceptionFilter());
};

export const configureSwagger = (app: NestExpressApplication): void => {
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Nexo Commerce API Gateway')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);

  SwaggerModule.setup('api/docs', app, document);
};

export const bootstrap = async (): Promise<void> => {
  const environment = parseBaseEnvironment(process.env);
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  configureHttpApp(app);
  configureSwagger(app);
  await app.init();
  await app.listen(environment.PORT);
};

if (require.main === module) {
  void bootstrap();
}
