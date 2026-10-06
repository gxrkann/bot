/**
 * Ortam değişkenlerini okur.
 *
 * Panel ortamında .env dosyası yoktur (dosya .gitignore'dadır).
 * Bu yüzden burada birkaç kaynak sırayla denenir:
 *
 *   1. process.env        — panelde tanımlanan değişkenler (en doğru)
 *   2. .env               — yerel geliştirme
 *   3. env.txt            — panel .env'yi nokta dosyası diye attığında
 *   4. config.local.json  — panel nokta dosyalarını da atıyorsa
 *
 * Birçok barındırma paneli güvenlik gereği nokta ile başlayan dosyaları
 * (dotfile) arşivden çıkarırken atlıyor. .gitignore'daki .env de yüklenen
 * ZIP'e girmiyor. Sonuç: kullanıcı doğru paketi yüklediği halde token
 * panelde görünmüyor. env.txt aynı içerikle, nokta olmayan isimle duruyor
 * bu yüzden her iki panelde de çalışıyor.
 *
 * Öncelik her zaman process.env'de: panelde tanımlı değer kazanır.
 */
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLocalConfig } from './local-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

/** Hangi kaynaktan okunduğunu sonradan hatırlayabilmek için. */
export const envSource = { file: null, keys: [] };

/* --- 1. .env --- */
dotenv.config({ path: path.join(rootDir, '.env') });

/* --- 2. env.txt (nokta dosyası olmayan yedek) ---
   dotenv aynı sözdizimini kullanır. process.env'ye ZATEN yazılmış
   değerleri ezmez (dotenv varsayılan davranışı), yani panelde tanımlı
   değişken her zaman kazanır. */
dotenv.config({ path: path.join(rootDir, 'env.txt') });

/* --- 3. config.local.json --- */
function applyJsonSource() {
  const file = path.join(rootDir, 'config.local.json');
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== 'object') return;

  for (const [key, value] of Object.entries(parsed)) {
    if (value === undefined || value === null) continue;
    if (process.env[key] !== undefined && process.env[key] !== '') continue;
    process.env[key] = String(value);
    envSource.keys.push(key);
  }
  envSource.file = 'config.local.json';
}

applyJsonSource();

/* --- 4. bot.config.json — panel son çaresi ---
   Ortam değişkeni alanı olmayan paneller için. Nokta içermeyen isim
   ZIP'e giriyor ve paneller onu atmıyor. */
const localConfigFile = loadLocalConfig();
if (localConfigFile) envSource.file = localConfigFile;

/* --- Kaydı: hangi dosyadan okundu? --- */
for (const name of ['.env', 'env.txt', 'config.local.json', 'bot.config.json']) {
  try {
    fs.accessSync(path.join(rootDir, name));
    if (!envSource.file) envSource.file = name;
  } catch { /* yok */ }
}

function parseOwnerIds() {
  const rawValues = [process.env.OWNER_ID, process.env.OWNER_ID_2, process.env.OWNER_IDS]
    .filter(Boolean)
    .flatMap((value) => String(value).split(',').map((id) => id.trim()).filter(Boolean));

  return [...new Set(rawValues)];
}

const ownerIds = parseOwnerIds();

export const config = {
  token: process.env.DISCORD_TOKEN || '',
  clientId: process.env.CLIENT_ID || '',
  guildId: process.env.GUILD_ID || '',
  ownerId: ownerIds[0] || '',
  ownerIds,
  botName: process.env.BOT_NAME || 'AxionV',
  defaultLogChannel: process.env.DEFAULT_LOG_CHANNEL || ''
};
