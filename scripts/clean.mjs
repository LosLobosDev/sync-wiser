import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const distPath = resolve('dist');

if (existsSync(distPath)) {
  rmSync(distPath, { recursive: true, force: true });
}
