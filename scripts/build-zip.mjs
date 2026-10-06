/**
 * Discloud dağıtım paketi oluşturur.
 *
 * Kullanım:  node scripts/build-zip.mjs
 * Çıktı:     dist/guard-bot.zip
 *
 * .discloudignore kurallarına göre dosyaları dışarıda bırakır ve ZIP'e paketler.
 * .env hiçbir zaman pakete girmez — token platforma sadece panelden girilir.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

/* ------------------------------------------------------------------ *
 * .discloudignore okuma
 * ------------------------------------------------------------------ */

async function loadIgnorePatterns() {
  const file = path.join(rootDir, '.discloudignore');
  const raw = await fsp.readFile(file, 'utf8');

  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

/** Klasör veya dosya yolunun yoksayılıp yoksayılmayacağını kontrol eder. */
function isIgnored(relativePath, patterns) {
  const normalized = relativePath.split(path.sep).join('/');

  return patterns.some((pattern) => {
    if (pattern.startsWith('!')) return false;  // istisna bizde yok

    // Dizin deseni: foo/ veya foo
    const clean = pattern.replace(/\/$/, '');
    if (normalized === clean) return true;
    if (normalized.startsWith(`${clean}/`)) return true;

    // Joker: *.log
    if (clean.includes('*')) {
      const regex = new RegExp(`^${clean.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
      if (regex.test(path.basename(normalized))) return true;
    }
    return false;
  });
}

/* ------------------------------------------------------------------ *
 * Dosya toplama
 * ------------------------------------------------------------------ */

async function collectFiles(patterns) {
  const included = [];

  async function walk(dir, relative = '') {
    const entries = await fsp.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = relative ? path.join(relative, entry.name) : entry.name;

      if (isIgnored(relPath, patterns)) continue;

      if (entry.isDirectory()) {
        await walk(fullPath, relPath);
      } else if (entry.isFile()) {
        included.push({ absolute: fullPath, relative: relPath.split(path.sep).join('/') });
      }
    }
  }

  await walk(rootDir);
  return included;
}

/* ------------------------------------------------------------------ *
 * ZIP yazımı (harici kütüphane olmadan)
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

/** ZIP arşivi oluşturur (deflate + store karışık, storedOnly=false). */
async function createZip(entries, outputPath) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const data = await fsp.readFile(entry.absolute);
    const nameBuffer = Buffer.from(entry.relative, 'utf8');
    const crc = crc32(data);

    const compressed = zlib.deflateRawSync(data, { level: 9 });
    // Sıkıştırma işe yaramadıysa (zaten sıkıştırılmış dosyalar) sakla.
    const useDeflate = compressed.length < data.length;
    const payload = useDeflate ? compressed : data;
    const method = useDeflate ? 8 : 0;

    /* --- Yerel dosya başlığı --- */
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);          // sürüm
    localHeader.writeUInt16LE(0x0800, 6);      // dosya adı UTF-8 bayrağı
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10);          // mod zamanı
    localHeader.writeUInt16LE(0x21, 12);       // tarih (sabit)
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuffer, payload);

    /* --- Merkez dizin kaydı --- */
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x21, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);        // ek alan
    centralHeader.writeUInt16LE(0, 32);        // yorum
    centralHeader.writeUInt16LE(0, 34);        // disk no
    centralHeader.writeUInt16LE(0, 36);        // iç attrs
    centralHeader.writeUInt32LE(0, 38);        // dış attrs
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + payload.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(offset, 16);
  endRecord.writeUInt16LE(0, 20);

  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, Buffer.concat([...localParts, centralDirectory, endRecord]));

  return offset + centralDirectory.length + endRecord.length;
}

/* ------------------------------------------------------------------ *
 * Ana akış
 * ------------------------------------------------------------------ */

async function main() {
  const patterns = await loadIgnorePatterns();
  const files = await collectFiles(patterns);

  /* Güvenlik kontrolü: paket içinde .env olmamalı. */
  const leaked = files.filter((file) =>
    /(^|\/)\.env($|\.)/.test(file.relative) && !file.relative.endsWith('.env.example')
  );
  if (leaked.length) {
    console.error('❌ Pakete sızması gereken dosya var, iptal ediliyor:');
    for (const file of leaked) console.error(`   ${file.relative}`);
    process.exit(1);
  }

  const required = ['discloud.config', 'package.json', 'src/index.js'];
  const missing = required.filter((name) => !files.some((file) => file.relative === name));
  if (missing.length) {
    console.error(`❌ Zorunlu dosyalar eksik: ${missing.join(', ')}`);
    process.exit(1);
  }

  console.log(`📦 ${files.length} dosya paketleniyor...\n`);
  for (const file of files) {
    console.log(`   ${file.relative}`);
  }

  const outputPath = path.join(distDir, 'guard-bot.zip');
  const size = await createZip(files, outputPath);

  console.log(`\n✅ Hazır: ${path.relative(rootDir, outputPath)}`);
  console.log(`   boyut: ${(size / 1024).toFixed(1)} KB`);

  console.log('\n📌 Discloud\'da yapman gerekenler:');
  console.log('   1. discloud.com/dashboard → Applications → + Upload → Upload ZIP');
  console.log('   2. Bu ZIP dosyasını yükle');
  console.log('   3. Ortam değişkenlerini panelde gir:');
  console.log('      DISCORD_TOKEN, CLIENT_ID, GUILD_ID, OWNER_ID');
  console.log('   4. Dashboard varsayılan olarak kapalı: DASHBOARD_ENABLED=false');
  console.log('      (Discloud botlara dış port vermiyor)');
}

main().catch((error) => {
  console.error('❌ Paketleme başarısız:', error.message);
  process.exit(1);
});
