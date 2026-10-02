import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const providersDir = path.join(__dirname, '..', 'providers');

const required = ['getInfo', 'search', 'getDetail', 'getAudioSources'];

for (const file of fs.readdirSync(providersDir)) {
  if (!file.endsWith('.js') || file.startsWith('_')) continue;
  const src = fs.readFileSync(path.join(providersDir, file), 'utf8');
  for (const fn of required) {
    assert.match(src, new RegExp(`exports\\.${fn}\\s*=`));
  }
}

console.log('Provider contract OK');
