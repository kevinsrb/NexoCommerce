import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({ imports: [AuthModule], controllers: [CatalogController], providers: [CatalogService, PrismaService] })
export class CatalogModule {}
