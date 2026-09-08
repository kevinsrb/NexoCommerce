import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadEnvironment, parseEnvironment } from '../src/common/environment';

describe('API gateway environment', () => {
  it('defaults its listener to port 3003 without changing the shared base default', () => {
    expect(parseEnvironment({})).toEqual({ NODE_ENV: 'development', PORT: 3003 });
  });

  it('loads a gateway app-local dotenv file into the runtime environment', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nexo-gateway-environment-'));
    const environment: Record<string, string> = {};
    const environmentFile = join(directory, '.env');

    try {
      writeFileSync(environmentFile, 'NODE_ENV=test\nPORT=43123\n');

      expect(loadEnvironment(environment, environmentFile)).toEqual({
        NODE_ENV: 'test',
        PORT: 43123,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
