import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsObject,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';

class PriceExpectationDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsUUID('4')
  variantId!: string;
  @IsString() @Matches(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/) price_decimal!: string;
  @IsString() @Matches(/^[A-Z]{3}$/) currency!: string;
}

export class CheckoutDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique((v: PriceExpectationDto) => v.variantId)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => PriceExpectationDto)
  expectedPrices!: PriceExpectationDto[];
}
