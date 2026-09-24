import fs from 'fs';
import path from 'path';

// The compiled server is CommonJS. A package that only ships ES modules can be require()d
// only on Node 20.19+, 22.12+ and 24, so a static import of one makes the whole app fail to
// load on an older runtime, and every route answers 500, even /api/health. That is what took
// production down when jose 6 (ES modules only) was imported at the top of a file.
// Such a package must be loaded with a dynamic import(). The CI "build" job also loads the
// compiled app on Node 22.11 to catch any other package that has the same problem.

const ESM_ONLY = ['jose'];
const SERVER = __dirname;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

describe('packages that only ship ES modules', () => {
  test.each(ESM_ONLY)('%s is never imported statically by the server', (name) => {
    const staticImport = new RegExp(
      String.raw`^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+['"]${name}['"]`,
      'm'
    );
    const offenders = sourceFiles(SERVER).filter((file) =>
      staticImport.test(fs.readFileSync(file, 'utf8'))
    );
    expect(offenders.map((file) => path.relative(SERVER, file))).toEqual([]);
  });

  test('the check itself recognises a static import', () => {
    const staticImport = /^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+['"]jose['"]/m;
    expect(staticImport.test("import { SignJWT } from 'jose';")).toBe(true);
    expect(staticImport.test("import type { JWTPayload } from 'jose';")).toBe(false);
    expect(staticImport.test("const jose = () => import('jose');")).toBe(false);
  });
});
