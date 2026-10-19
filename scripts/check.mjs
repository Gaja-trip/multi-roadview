import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

for (const directory of ['src', 'electron', 'scripts']) {
  for (const file of await fs.readdir(new URL(`../${directory}/`, import.meta.url))) {
    if (!/\.(js|cjs|mjs)$/.test(file)) continue;
    const filename = new URL(`../${directory}/${file}`, import.meta.url);
    const source = await fs.readFile(filename, 'utf8');
    const args = file.endsWith('.cjs') ? ['--check'] : ['--input-type=module', '--check'];
    const result = spawnSync(process.execPath, args, { input: source, encoding: 'utf8' });
    if (result.status !== 0) { console.error(`${directory}/${file}\n${result.stderr}`); process.exitCode = 1; }
  }
}
if (!process.exitCode) console.log('렌더러 ES 모듈 및 Electron·빌드 스크립트 문법 검사 완료');
