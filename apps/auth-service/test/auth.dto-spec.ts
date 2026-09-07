import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto, RegisterDto } from '../src/auth/auth.dto';

describe('Auth credential size boundary', () => {
  it.each([RegisterDto, LoginDto])(
    '%p rejects a password longer than 1024 characters',
    async (Dto) => {
      const input = plainToInstance(Dto, {
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        password: 'x'.repeat(1025),
      });
      const errors = await validate(input);
      expect(errors.find((error) => error.property === 'password')?.constraints).toHaveProperty(
        'maxLength',
      );
    },
  );
});
