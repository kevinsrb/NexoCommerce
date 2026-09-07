import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  password!: string;
}

export class RegisterDto extends LoginDto {
  @MinLength(12)
  declare password: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  name!: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  refreshToken!: string;
}
