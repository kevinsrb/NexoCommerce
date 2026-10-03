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

export class ReadCartDto {
  @IsUUID('4')
  principalId!: string;
}

export class ClaimCartDto extends ReadCartDto {
  @IsUUID('4')
  attemptId!: string;

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedVersion!: number;
}

export class FinishCartClaimDto extends ReadCartDto {
  @IsUUID('4')
  attemptId!: string;

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  version!: number;
}
