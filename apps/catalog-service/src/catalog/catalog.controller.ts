import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  CreateCategoryDto,
  CreateProductDto,
  BatchVariantsDto,
  ListProductsDto,
  UpdateProductDto,
} from './catalog.dto';
import { CatalogService } from './catalog.service';
import { AdminGuard } from '../auth/admin.guard';
import { CatalogInternalGuard } from '../common/internal-service.guard';

@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('products')
  listProducts(@Query() query: ListProductsDto) {
    return this.catalog.listProducts(query);
  }

  @Get('products/:slug')
  getProduct(@Param('slug') slug: string) {
    return this.catalog.getProduct(slug);
  }

  @Get('categories')
  listCategories() {
    return this.catalog.listCategories();
  }

  @Post('internal/variants/batch')
  @UseGuards(CatalogInternalGuard)
  getInternalVariants(@Body() dto: BatchVariantsDto) {
    return this.catalog.getInternalVariants(dto.ids);
  }

  // Temporary Phase 1 administration: distributed authorization is deferred.
  @Post('products')
  @UseGuards(AdminGuard)
  createProduct(@Body() dto: CreateProductDto) {
    return this.catalog.createProduct(dto);
  }

  @Patch('products/:id')
  @UseGuards(AdminGuard)
  updateProduct(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateProductDto) {
    return this.catalog.updateProduct(id, dto);
  }

  @Post('categories')
  @UseGuards(AdminGuard)
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.catalog.createCategory(dto);
  }
}
