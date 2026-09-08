import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Category } from '../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateCategoryDto,
  CreateProductDto,
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

type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof include }>;
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
    stock: variant.stock,
    active: variant.active,
  })),
});
const variantData = (
  variant: CreateVariantDto,
): Prisma.ProductVariantCreateWithoutProductInput => ({
  sku: variant.sku,
  name: variant.name,
  price: new Prisma.Decimal(variant.price),
  currency: variant.currency,
  stock: variant.stock,
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
    const product = await this.prisma.product.update({
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
    return presentProduct(product);
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

  async createCategory(dto: CreateCategoryDto) {
    return presentCategory(
      await this.prisma.category.create({ data: { name: dto.name, slug: dto.slug } }),
    );
  }

  async listCategories() {
    return (await this.prisma.category.findMany({ orderBy: { slug: 'asc' } })).map(presentCategory);
  }
}
