/**
 * @nestjs/common@11.1.x ships use-interceptors.decorator.js without a matching .d.ts,
 * which breaks TypeScript. Restore the minimal declaration after npm install.
 */
const fs = require('fs');
const path = require('path');

const target = path.join(
  __dirname,
  '..',
  'node_modules',
  '@nestjs',
  'common',
  'decorators',
  'core',
  'use-interceptors.decorator.d.ts',
);

const contents = `/**
 * @publicApi
 */
export declare const UseInterceptors: (
  ...interceptors: (Function | object)[]
) => MethodDecorator & ClassDecorator;
`;

try {
  if (!fs.existsSync(path.dirname(target))) {
    process.exit(0);
  }
  fs.writeFileSync(target, contents, 'utf8');
} catch {
  // ignore (e.g. read-only node_modules in CI)
}
