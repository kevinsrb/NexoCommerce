import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsObject,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const lowercase = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.toLowerCase() : value;

export class ReservationLineDto {
  @Transform(lowercase)
  @IsUUID('4')
  variantId!: string;

  @IsInt()
  @Min(1)
  @Max(2147483647)
  quantity!: number;

  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/)
  expected_price_decimal!: string;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  expected_currency!: string;
}

export class ReserveDto {
  @Transform(lowercase)
  @IsUUID('4')
  attemptId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique((line: ReservationLineDto) => line.variantId)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => ReservationLineDto)
  lines!: ReservationLineDto[];
}

export class PublishOrderDto {
  @Transform(lowercase)
  @IsUUID('4')
  orderId!: string;
}
