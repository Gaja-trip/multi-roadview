import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url), output = new URL('dist/', root);
await fs.mkdir(output, { recursive: true });
for (const name of ['index.html', 'src']) await fs.cp(new URL(name, root), new URL(name, output), { recursive: true });
console.log(`웹 빌드 완료: ${fileURLToPath(output)}`);
