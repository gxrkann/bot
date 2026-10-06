/**
 * .env dosyasını şifreler.
 *
 * Kullanım:
 *   node scripts/encrypt-env.mjs                 -> .env.enc
 *   node scripts/encrypt-env.mjs parola           -> parola korumalı
 *
 * AES-256-GCM. Parola verilmezse işlem çalışma sırasında üretilir ve
 * bir kez ekrana yazdırılır (kaydedemezsen şifre çözülemez).
 */
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

const SOURCE = path.join(rootDir, '.env');
const TARGET = path.join(rootDir, '.env.enc');

const MAGIC = 'GUARDENV1';
const ITERATIONS = 210000;  // PBKDF2 yineleme sayısı (OWASP 2023 önerisi)
const KEY_LENGTH = 32;

function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha256');
}

/** Rastgele parola üretir (güvenli karakterlerden). */
function generatePassword(length = 32) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

async function askPassword() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Parola (boş bırakırsanız üretilir): ');
  rl.close();
  return answer;
}

async function main() {
  let plaintext;
  try {
    plaintext = await fs.readFile(SOURCE, 'utf8');
  } catch {
    console.error(`❌ ${SOURCE} bulunamadı. Önce .env oluşturun.`);
    process.exit(1);
  }

  console.log(`📄 ${path.relative(rootDir, SOURCE)} okundu (${plaintext.length} karakter)`);

  /* Token'lar dosyada gerçekten var mı? Kullanıcıyı uyar. */
  const secrets = ['DISCORD_TOKEN', 'DASHBOARD_CLIENT_SECRET']
    .filter((key) => new RegExp(`^${key}=.+`, 'm').test(plaintext));

  if (secrets.length) {
    console.log(`🔑 Şifrelenecek hassas alanlar: ${secrets.join(', ')}`);
  }

  /* Etkileşimli mi? Değilse (CI, piping, pipe ile çalıştırma) parola sorulmaz,
     üretilir. stdin kapalıysa readline sonsuza kadar bekler. */
const interactive = process.argv.includes('--interactive') || (process.stdin.isTTY === true);
  const provided = process.argv[2] || (interactive ? await askPassword() : '');
  const generated = !provided;
  const password = provided || generatePassword();

  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, salt);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  /* Çıktı: başlık satırı + base64 parçaları. Elle taşınabilir. */
  const output = [
    MAGIC,
    `salt:${salt.toString('base64')}`,
    `iv:${iv.toString('base64')}`,
    `tag:${authTag.toString('base64')}`,
    `data:${encrypted.toString('base64')}`
  ].join('\n');

  await fs.writeFile(TARGET, output + '\n', { encoding: 'utf8', mode: 0o600 });

  console.log(`\n✅ Şifrelendi -> ${path.relative(rootDir, TARGET)}`);
  console.log(`   algoritma: AES-256-GCM | PBKDF2-${ITERATIONS} (sha256)`);

  if (generated) {
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║  PAROLA (sadece bir kez gösteriliyor)                 ║');
    console.log('║  Şifreyi çözmek için güvenli bir yere kaydet.          ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log(`\n${password}\n`);
  }

  console.log('Şifre çözmek için:  node scripts/decrypt-env.mjs');
}

main().catch((error) => {
  console.error('❌ Şifreleme başarısız:', error.message);
  process.exit(1);
});
