/**
 * Şifrelenmiş .env.enc dosyasını çözer.
 *
 * Kullanım:
 *   node scripts/decrypt-env.mjs
 *   node scripts/decrypt-env.mjs parola
 *   node scripts/decrypt-env.mjs parola --stdout        (diske yazmadan gösterir)
 *
 * Pella gibi platformlarda: çözdüğün değerleri paneldeki ortam
 * değişkenleri alanına tek tek gir, düz metin .env olarak depolamayın.
 */
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

const SOURCE = path.join(rootDir, '.env.enc');
const TARGET = path.join(rootDir, '.env');

const MAGIC = 'GUARDENV1';
const ITERATIONS = 210000;
const KEY_LENGTH = 32;

function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha256');
}

async function askPassword() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Parola: ');
  rl.close();
  return answer;
}

function parseEnvelope(text) {
  const lines = text.trim().split('\n');
  if (lines[0]?.trim() !== MAGIC) {
    throw new Error('Bu dosya guard botu tarafından şifrelenmemiş.');
  }

  const parts = {};
  for (const line of lines.slice(1)) {
    const index = line.indexOf(':');
    if (index === -1) continue;
    parts[line.slice(0, index)] = line.slice(index + 1);
  }

  for (const key of ['salt', 'iv', 'tag', 'data']) {
    if (!parts[key]) throw new Error(`Dosya bozuk: "${key}" eksik.`);
  }

  return {
    salt: Buffer.from(parts.salt, 'base64'),
    iv: Buffer.from(parts.iv, 'base64'),
    authTag: Buffer.from(parts.tag, 'base64'),
    data: Buffer.from(parts.data, 'base64')
  };
}

async function main() {
  let raw;
  try {
    raw = await fs.readFile(SOURCE, 'utf8');
  } catch {
    console.error(`❌ ${SOURCE} bulunamadı. Önce node scripts/encrypt-env.mjs çalıştır.`);
    process.exit(1);
  }

  const envelope = parseEnvelope(raw);
  const interactive = process.argv.includes('--interactive') || (process.stdin.isTTY === true);
  const password = process.argv[2] || (interactive ? await askPassword() : '');

  if (!password) {
    console.error('❌ Parola gerekli. Kullanım: node scripts/decrypt-env.mjs <parola>');
    process.exit(1);
  }

  let plaintext;
  try {
    const key = deriveKey(password, envelope.salt);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, envelope.iv);
    decipher.setAuthTag(envelope.authTag);
    plaintext = Buffer.concat([decipher.update(envelope.data), decipher.final()]).toString('utf8');
  } catch {
    console.error('❌ Parola yanlış veya dosza müdahale edilmiş.');
    process.exit(1);
  }

  /* --stdout: diske yazmadan yalnızca ekrana bas (Pella kurulumu için). */
  if (process.argv.includes('--stdout')) {
    console.log(plaintext);
    return;
  }

  await fs.writeFile(TARGET, plaintext, { encoding: 'utf8', mode: 0o600 });
  console.log(`✅ Çözüldü -> ${path.relative(rootDir, TARGET)}`);

  /* Hangi anahtarlar var, değerleri göstermeden. */
  const keys = plaintext
    .split('\n')
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => line.split('=')[0]);

  console.log(`\n📋 ${keys.length} anahtar:`);
  console.log(`   ${keys.join('\n  ')}`);

  /* Panelde yapılacaklar */
  console.log('\n📌 Bu değerleri Pella panelinde ortam değişkeni olarak gir:');
  for (const key of keys) {
    if (key.endsWith('_ID')) continue;   // kimlikler gizli değil
    console.log(`   ${key}`);
  }
}

main().catch((error) => {
  console.error('❌ Çözme başarısız:', error.message);
  process.exit(1);
});
