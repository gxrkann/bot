/**
 * Test koşucusu — tüm test dosyalarını sırayla çalıştırır.
 * Kullanım: npm test
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const suites = [
  'boot.test.mjs',
  'systems.test.mjs',
  'profile.test.mjs',
  'dashboard.test.mjs'
];

const run = (file) => new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(__dirname, file)], {
    stdio: 'inherit'
  });
  child.on('close', (code) => resolve(code === 0));
});

let failed = 0;

for (const suite of suites) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${suite}`);
  console.log('='.repeat(60));

  const ok = await run(suite);
  if (!ok) {
    failed++;
    console.log(`\n❌ ${suite} BAŞARISIZ`);
  }
}

console.log('');
if (failed === 0) {
  console.log('✅ Tüm testler geçti.');
} else {
  console.log(`❌ ${failed} test dosyası başarısız.`);
}
process.exit(failed === 0 ? 0 : 1);
