import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { type InternalCatalogVariant } from '@nexo/contracts';
import { Prisma, type Category } from '../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogDomainException } from '../common/catalog-domain.exception';
import {
  CreateCategoryDto,
  CreateProductDto,
  BatchVariantsDto,
  CreateVariantDto,
  ListProductsDto,
  UpdateProductDto,
} from './catalog.dto';

const include = {
  category: true,
  variants: { orderBy: { sku: 'asc' as const } },
} satisfies Prisma.ProductInclude;
const publicInclude = {
  ...include,
  variants: { ...include.variants, where: { active: true } },
} satisfies Prisma.ProductInclude;
const internalVariantInclude = { product: true } satisfies Prisma.ProductVariantInclude;

type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof include }>;
type InternalVariantWithProduct = Prisma.ProductVariantGetPayload<{
  include: typeof internalVariantInclude;
}>;
const presentCategory = (category: Category) => ({
  id: category.id,
  name: category.name,
  slug: category.slug,
});
const presentProduct = (product: ProductWithRelations) => ({
  id: product.id,
  name: product.name,
  slug: product.slug,
  description: product.description,
  active: product.active,
  category: presentCategory(product.category),
  variants: product.variants.map((variant) => ({
    id: variant.id,
    sku: variant.sku,
    name: variant.name,
    price: variant.price.toFixed(2),
    currency: variant.currency,
    stock: variant.onHand - variant.reserved,
    available: variant.onHand - variant.reserved,
    active: variant.active,
  })),
});
const presentInternalVariant = (
  variant: InternalVariantWithProduct,
): InternalCatalogVariant & { available: number } => ({
  id: variant.id,
  productId: variant.productId,
  productName: variant.product.name,
  variantName: variant.name,
  price: variant.price.toFixed(2),
  currency: variant.currency,
  stock: variant.onHand - variant.reserved,
  available: variant.onHand - variant.reserved,
  productActive: variant.product.active,
  variantActive: variant.active,
});
const variantData = (
  variant: CreateVariantDto,
): Prisma.ProductVariantCreateWithoutProductInput => ({
  sku: variant.sku,
  name: variant.name,
  price: new Prisma.Decimal(variant.price),
  currency: variant.currency,
  onHand: variant.stock,
  active: variant.active,
});

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async createProduct(dto: CreateProductDto) {
    const { categoryId, variants, ...fields } = dto;
    const product = await this.prisma.product.create({
      data: {
        ...fields,
        category: { connect: { id: categoryId } },
        variants: { create: variants.map(variantData) },
      },
      include,
    });
    return presentProduct(product);
  }

  async updateProduct(id: string, dto: UpdateProductDto) {
    if (Object.values(dto).every((value) => value === undefined))
      throw new BadRequestException('At least one product field is required');
    const { categoryId, variants, ...fields } = dto;
    const product = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${id}::uuid FOR UPDATE`;
      if (variants !== undefined) await this.protectVariants(tx, id);
      return tx.product.update({
        where: { id },
        data: {
          ...fields,
          ...(categoryId === undefined ? {} : { category: { connect: { id: categoryId } } }),
          // Nested writes are transactional: a failed replacement keeps the old variants.
          ...(variants === undefined
            ? {}
            : { variants: { deleteMany: {}, create: variants.map(variantData) } }),
        },
        include,
      });
    });
    return presentProduct(product);
  }

  private async protectVariants(tx: Prisma.TransactionClient, productId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string; reserved: number }>>`
      SELECT id, reserved FROM "ProductVariant" WHERE "productId" = ${productId}::uuid ORDER BY id FOR UPDATE`;
    if (rows.some((row) => row.reserved > 0))
      throw new CatalogDomainException(
        'INVENTORY_RESERVED',
        'Variants have nonterminal reservations',
        409,
      );
  }

  async deleteProduct(id: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${id}::uuid FOR UPDATE`;
      await this.protectVariants(tx, id);
      await tx.product.delete({ where: { id } });
      return { id };
    });
  }

  async adjustStock(id: string, onHand: number) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ProductVariant" WHERE id = ${id}::uuid FOR UPDATE`;
      const variant = await tx.productVariant.findUnique({ where: { id } });
      if (!variant) throw new NotFoundException('Variant not found');
      if (onHand < variant.reserved)
        throw new CatalogDomainException(
          'INVENTORY_RESERVED',
          'Stock cannot be lower than reserved quantity',
          409,
          { available: variant.onHand - variant.reserved, reserved: variant.reserved },
        );
      await tx.productVariant.update({ where: { id }, data: { onHand } });
      return { variantId: id, available: onHand - variant.reserved, reserved: variant.reserved };
    });
  }

  async getInternalVariant(id: string) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id },
      include: internalVariantInclude,
    });
    if (!variant) throw new CatalogDomainException('VARIANT_NOT_FOUND', 'Variant not found', 404);
    return {
      variantId: variant.id,
      sellable: variant.active && variant.product.active,
      available: variant.onHand - variant.reserved,
      price_decimal: variant.price.toFixed(2),
      currency: variant.currency,
    };
  }

  async getProduct(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { slug, active: true },
      include: publicInclude,
    });
    if (!product) throw new NotFoundException('Product not found');
    return presentProduct(product);
  }

  async listProducts(query: ListProductsDto) {
    const products = await this.prisma.product.findMany({
      where: { active: true },
      include: publicInclude,
      take: query.limit,
      skip: query.offset,
      orderBy: { slug: 'asc' },
    });
    return products.map(presentProduct);
  }

  async getInternalVariants(ids: BatchVariantsDto['ids']): Promise<InternalCatalogVariant[]> {
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: ids } },
      include: internalVariantInclude,
    });
    return variants.map(presentInternalVariant);
  }

  async createCategory(dto: CreateCategoryDto) {
    return presentCategory(
      await this.prisma.category.create({ data: { name: dto.name, slug: dto.slug } }),
    );
  }

  async listCategories() {
    return (await this.prisma.category.findMany({ orderBy: { slug: 'asc' } })).map(presentCategory);
  }
}
