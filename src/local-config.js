/**
 * Panelden token okuma — son çare.
 *
 * Bazı panellerde ortam değişkeni alanı yok, dosya düzenleyici yok, ZIP'e
 * .env koymak da işe yaramıyor (paneller nokta dosyalarını atıyor).
 *
 * Bu dosya O noktada devreye girer: nokta içermeyen bir isimle ZIP'e
 * giriyor, paneller onu atmıyor.
 *
 * GÜVENLİK: Bu dosya token içerir.
 *   - .gitignore ve .discloudignore'da → depoya GİRMEZ
 *   - ZIP'e girer → paketi ele geçiren token'ı görür
 *   - Bu yüzden token'ı resetlemek istersen bu dosyayı da yenile
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const CONFIG_FILE = 'bot.config.json';

/**
 * bot.config.json'dan değerleri okur ve process.env'e yazar.
 * process.env'de zaten değer varsa onu korur (panel her zaman kazanır).
 *
 * @returns {string|null} okunan dosya adı
 */
export function loadLocalConfig() {
  const file = path.join(rootDir, CONFIG_FILE);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  let wrote = 0;
  for (const [key, value] of Object.entries(parsed)) {
    if (value === undefined || value === null || value === '') continue;
    if (process.env[key] !== undefined && process.env[key] !== '') continue;
    process.env[key] = String(value);
    wrote++;
  }

  return wrote > 0 ? CONFIG_FILE : null;
}
