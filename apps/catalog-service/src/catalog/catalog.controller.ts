import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CreateCategoryDto,
  CreateProductDto,
  BatchVariantsDto,
  ListProductsDto,
  UpdateProductDto,
  AdjustStockDto,
} from './catalog.dto';
import { CatalogService } from './catalog.service';
import { AdminGuard } from '../auth/admin.guard';
import { CatalogInternalGuard } from '../common/internal-service.guard';
import { ReservationService } from './reservation.service';
import { PublishOrderDto, ReserveDto } from './reservation.dto';

@Controller()
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly reservations: ReservationService,
  ) {}

  @Get('internal/v1/variants/:variantId')
  @UseGuards(CatalogInternalGuard)
  getVariant(@Param('variantId', new ParseUUIDPipe()) id: string) {
    return this.catalog.getInternalVariant(id);
  }

  @Post('internal/v1/reservations')
  @UseGuards(CatalogInternalGuard)
  reserve(@Body() dto: ReserveDto) {
    return this.reservations.reserve(dto);
  }

  @Post('internal/v1/reservations/by-attempt/:attemptId/publish-order')
  @UseGuards(CatalogInternalGuard)
  publish(@Param('attemptId', new ParseUUIDPipe()) id: string, @Body() dto: PublishOrderDto) {
    return this.reservations.publish(id.toLowerCase(), dto.orderId);
  }

  @Get('internal/v1/reservations/by-attempt/:attemptId')
  @UseGuards(CatalogInternalGuard)
  reservationStatus(@Param('attemptId', new ParseUUIDPipe()) id: string) {
    return this.reservations.status(id.toLowerCase());
  }

  @Delete('internal/v1/reservations/by-attempt/:attemptId')
  @UseGuards(CatalogInternalGuard)
  release(@Param('attemptId', new ParseUUIDPipe()) id: string) {
    return this.reservations.release(id.toLowerCase());
  }

  @Patch('variants/:variantId/stock')
  @UseGuards(AdminGuard)
  adjustStock(@Param('variantId', new ParseUUIDPipe()) id: string, @Body() dto: AdjustStockDto) {
    return this.catalog.adjustStock(id, dto.onHand);
  }

  @Delete('products/:id')
  @UseGuards(AdminGuard)
  deleteProduct(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.catalog.deleteProduct(id);
  }

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
