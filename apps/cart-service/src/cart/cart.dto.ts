import { IsInt, IsUUID, Max, Min } from 'class-validator';

export class UpdateCartItemDto {
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  quantity!: number;
}

export class AddCartItemDto extends UpdateCartItemDto {
  @IsUUID('4')
  variantId!: string;
}
