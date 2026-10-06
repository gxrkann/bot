/**
 * Profil özellikleri testi — Discord API'si çağrılmadan.
 */
import { readImageSize, validateImage, ACTIVITY_TYPES, ACTIVITY_LABELS, STATUS_OPTIONS } from '../src/profile.js';

let failures = 0;
function check(label, ok, detail) {
  if (ok) console.log('  GECTI  ' + label);
  else { console.log('  KALDI  ' + label); failures++; }
  void detail;
}

console.log('=== 1. PNG boyut okuma ===');
{
  // 512x512 PNG başlığı (IHDR) — gerçek CRC/XID gerekmiyor, bizim parser
  // yalnızca 16. ve 20. baytları okuyor.
  const png = Buffer.alloc(33);
  png.writeUInt32BE(0x89504e47, 0);
  png.writeUInt32BE(0x0d0a1a0a, 4);
  png.writeUInt32BE(13, 8);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(512, 16);
  png.writeUInt32BE(512, 20);

  const size = readImageSize(png);
  check('PNG boyutu okundu', size && size.width === 512 && size.height === 512);
  check('PNG tipi tanındı', size?.type === 'PNG');
}

console.log('\n=== 2. JPEG boyut okuma ===');
{
  // JPEG: FFD8 + APP0 segmenti + SOF0
  const parts = [];
  parts.push(Buffer.from([0xff, 0xd8]));                       // SOI
  parts.push(Buffer.from([0xff, 0xe0, 0x00, 0x10]));           // APP0, uzunluk 16
  parts.push(Buffer.alloc(14));
  // SOF0: marker c0, uzunluk, precision(1), height(2), width(2)
  const sof = Buffer.alloc(11);
  sof[0] = 0xff; sof[1] = 0xc0;
  sof.writeUInt16BE(9, 2);
  sof.writeUInt16BE(240, 5);    // height
  sof.writeUInt16BE(1200, 7);   // width
  parts.push(sof);

  const size = readImageSize(Buffer.concat(parts));
  check('JPEG boyutu okundu', size && size.width === 1200 && size.height === 240);
  check('JPEG tipi tanındı', size?.type === 'JPEG');
}

console.log('\n=== 3. GIF boyut okuma ===');
{
  // GIF: 6 bayt imza, sonra mantıksal ekran tanımı (genişlik 6-7, yükseklik 8-9)
  const gif = Buffer.alloc(13);
  gif.write('GIF89a', 0, 'ascii');
  gif.writeUInt16LE(320, 6);   // genişlik
  gif.writeUInt16LE(240, 8);   // yükseklik
  const size = readImageSize(gif);
  check('GIF boyutu okundu', size && size.width === 320 && size.height === 240, size);
}

console.log('\n=== 4. Geçersiz veri ===');
{
  check('boş veri null döner', readImageSize(null) === null);
  check('çöp veri null döner', readImageSize(Buffer.from('merhaba dünya')) === null);
  check('kısa veri null döner', readImageSize(Buffer.alloc(10)) === null);
}

console.log('\n=== 5. Avatar doğrulaması ===');
{
  /* Hem geçerli bir PNG başlığı hem istenen boyutu taşıyan yardımcı.
   Avatar/banner doğrulaması ayrıca dosya boyutunu da kontrol ediyor. */
function makePng(w, h, sizeBytes = 200) {
    const png = Buffer.alloc(Math.max(33, sizeBytes));
    png.writeUInt32BE(0x89504e47, 0);
    png.writeUInt32BE(0x0d0a1a0a, 4);
    png.writeUInt32BE(13, 8);
    png.write('IHDR', 12, 'ascii');
    png.writeUInt32BE(w, 16);
    png.writeUInt32BE(h, 20);
    return png;
  }

  const good = validateImage(makePng(512, 512), 'avatar');
  check('512x512 avatar kabul', good.ok === true);

  const small = validateImage(makePng(64, 64), 'avatar');
  check('64x64 avatar reddedildi', small.ok === false);
  check('hata mesajı boyutu söylüyor', small.error.includes('64x64'));

  const garbage = validateImage(Buffer.from('bu bir resim degil'), 'avatar');
  check('okunamayan görsel reddedildi', garbage.ok === false);

  /* Dosya boyutu sınırı: 600 KB PNG (sınır 512 KB) */
const tooBig = validateImage(makePng(512, 512, 600 * 1024), 'avatar');
  check('512 KB üstü avatar uyarısı', tooBig.ok === false && tooBig.error.includes('sınır'), tooBig);

  /* Dosya 600 KB ama biçim geçersiz -> önce biçim hatası verilmeli */
  const bigGarbage = validateImage(Buffer.alloc(600 * 1024, 0x41), 'avatar');
  check('büyük çöp dosya biçim hatası verir', bigGarbage.ok === false && bigGarbage.error.includes('okunamadı'), bigGarbage);
}

console.log('\n=== 6. Banner doğrulaması ===');
{
  function makePng(w, h) {
    const png = Buffer.alloc(33);
    png.writeUInt32BE(0x89504e47, 0);
    png.writeUInt32BE(0x0d0a1a0a, 4);
    png.writeUInt32BE(13, 8);
    png.write('IHDR', 12, 'ascii');
    png.writeUInt32BE(w, 16);
    png.writeUInt32BE(h, 20);
    return png;
  }

  check('1200x480 banner kabul', validateImage(makePng(1200, 480), 'banner').ok === true);
  check('600x240 banner kabul', validateImage(makePng(600, 240), 'banner').ok === true);

  const small = validateImage(makePng(300, 150), 'banner');
  check('300x150 banner reddedildi', small.ok === false);
  check('hata 600x240 öneriyor', small.error.includes('600x240'));

  // Avatar için geçerli ama banner için geçersiz
  const mid = validateImage(makePng(512, 512), 'banner');
  check('512x512 banner reddedildi (yükseklik yetersiz)', mid.ok === false);
}

console.log('\n=== 7. Activity türleri ===');
{
  check('playing tanımlı', ACTIVITY_TYPES.playing !== undefined);
  check('watching tanımlı', ACTIVITY_TYPES.watching !== undefined);
  check('custom tanımlı', ACTIVITY_TYPES.custom !== undefined);
  check('her türün etiketi var', Object.keys(ACTIVITY_TYPES).every((k) => ACTIVITY_LABELS[k]));
  check('her durumun etiketi var', Object.values(STATUS_OPTIONS).every(Boolean));
}

console.log('\n=== 8. Profil komutu şeması ===');
{
  const { default: command } = await import('../src/commands/profil.js');
  const json = command.data.toJSON();

  check('komut adı profil', json.name === 'profil');
  check('alt komut sayısı 6', json.options.length === 6);

  const names = json.options.map((o) => o.name);
  check('gorunum alt komutu var', names.includes('gorunum'));
  check('avatar alt komutu var', names.includes('avatar'));
  check('avatar-kaldir var', names.includes('avatar-kaldir'));
  check('banner alt komutu var', names.includes('banner'));
  check('banner-kaldir var', names.includes('banner-kaldir'));
  check('oyun alt komutu var', names.includes('oyun'));

  const avatar = json.options.find((o) => o.name === 'avatar');
  check('avatar görsel ister', avatar.options.some((o) => o.type === 11 && o.required === true));

  const banner = json.options.find((o) => o.name === 'banner');
  check('banner görsel ister', banner.options.some((o) => o.type === 11 && o.required === true));

  const oyun = json.options.find((o) => o.name === 'oyun');
  check('oyun yazı alanı 128 karakter sınırlı', oyun.options.some((o) => o.name === 'yazi' && o.max_length === 128));
  check('oyun tür seçeneği var', oyun.options.some((o) => o.name === 'tur' && o.choices?.length === 5));
  check('oyun durum seçeneği var', oyun.options.some((o) => o.name === 'durum' && o.required === false));

  void 0;
}

console.log(failures === 0 ? '\n*** TUM TESTLER GECTI ***' : `\n*** ${failures} TEST BASARISIZ ***`);
process.exit(failures === 0 ? 0 : 1);
