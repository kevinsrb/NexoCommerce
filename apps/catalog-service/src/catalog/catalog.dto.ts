import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class AdjustStockDto {
  @IsInt()
  @Min(0)
  @Max(2147483647)
  onHand!: number;
}

export class CreateCategoryDto {
  @IsString()
  @Matches(/\S/)
  @MaxLength(200)
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(150)
  slug!: string;
}

export class CreateVariantDto {
  @IsString()
  @Matches(/\S/)
  @MaxLength(100)
  sku!: string;

  @IsString()
  @Matches(/\S/)
  @MaxLength(200)
  name!: string;

  // Decimal(18,2): up to 16 integral digits. Never coerce through a JS number.
  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/)
  price!: string;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  stock?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  active?: boolean;
}

export class CreateProductDto extends CreateCategoryDto {
  @IsString()
  @MaxLength(10000)
  description!: string;

  @IsUUID()
  categoryId!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  active?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => CreateVariantDto)
  variants!: CreateVariantDto[];
}

export class UpdateProductDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(/\S/)
  @MaxLength(200)
  name?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(150)
  slug?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(10000)
  description?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID()
  categoryId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  active?: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => CreateVariantDto)
  variants?: CreateVariantDto[];
}

export class ListProductsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  offset = 0;
}

export class BatchVariantsDto {
  @Transform(({ value }) => Array.isArray(value) ? value.map((id: unknown) => typeof id === 'string' ? id.toLowerCase() : id) : value)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  ids!: string[];
}
