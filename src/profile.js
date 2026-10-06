/**
 * Bot profili: avatar (PP), banner, oyun adı (activity) ve durum.
 *
 * Discord API sınırı — önemli:
 *   Profil altındaki yazı iki farklı şey olabilir.
 *     • Rich Presence ("X oyunu oynuyor") yalnızca masaüstü/mobil
 *       uygulamanın RPC kanalı üzerinden ayarlanabilir. Botlar BUNU
 *       YAPAMAZ. setRPGCustomStatus sunucudan çalışmaz.
 *     • Activity (botun etkinliği) setActivity() ile ayarlanabilir ve
 *       profil altında görünür. Bu botun yapabildiği şey budur.
 *
 * Yani "alta oyun ismi" dediğin görsel için Activity kullanıyoruz:
 *   Watching / Playing / Listening / Competing / Custom
 */
import { ActivityType } from 'discord.js';

/** Activity türleri — dashboard'daki seçim listesiyle eşleşir. */
export const ACTIVITY_TYPES = {
  playing: ActivityType.Playing,
  watching: ActivityType.Watching,
  listening: ActivityType.Listening,
  competing: ActivityType.Competing,
  custom: ActivityType.Custom
};

export const ACTIVITY_LABELS = {
  playing: 'Playing',
  watching: 'Watching',
  listening: 'Listening',
  competing: 'Competing',
  custom: 'Custom'
};

/** Durum seçenekleri (Çevrimiçi, Görünmez, Meşgul, Uyku). */
export const STATUS_OPTIONS = {
  online: 'Çevrimiçi',
  idle: 'Görünmez',
  dnd: 'Meşgul',
  invisible: 'Görünmez (offline)'
};

/** Görsel boyut sınırları — Discord bunların dışını reddeder. */
const AVATAR_MAX_BYTES = 512 * 1024;        // 512 KB
const BANNER_MAX_BYTES = 8 * 1024 * 1024;   // 8 MB
const BANNER_MIN_DIMENSION = 600;           // en az 600x240

/**
 * Görsel piksel boyutlarını okur (harici kütüphane olmadan).
 * Discord banner için 600x240, avatar için 128x128 üstü istiyor; boyutu
 * bilmeden göndermek "Invalid Form Body" hatası veriyor, o yüzden önce
 * ölçüyoruz ve kullanıcıya anlaşılır mesaj gösteriyoruz.
 *
 * @returns {{width:number, height:number, type:string}|null}
 */
export function readImageSize(buffer) {
  if (!buffer || buffer.length < 10) return null;

  /* PNG: 8 byte imza, sonra IHDR başlığı (genişlik 16-19, yükseklik 20-23) */
  if (buffer.length >= 24 && buffer.readUInt32BE(0) === 0x89504e47) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), type: 'PNG' };
  }

  /* JPEG: FF D8, ardından segmentler içinde SOF0/SOF2 boyut bilgisi */
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length - 9) {
      if (buffer[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buffer[offset + 1];
      // SOF0..SOF15, DHT/C4/C8/CC istisna
      const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf &&
        marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isStartOfFrame) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
          type: 'JPEG'
        };
      }
      const segmentLength = buffer.readUInt16BE(offset + 2);
      if (segmentLength < 2) return null;
      offset += 2 + segmentLength;
    }
    return null;
  }

  /* GIF: 6 byte imza, sonra mantıksal ekran tanımı */
  if (buffer.slice(0, 3).toString('ascii') === 'GIF') {
    // GIF başlığı "GIF87a" veya "GIF89a" olabilir; ilk 3 bayt yeterli.
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8), type: 'GIF' };
  }

  return null;
}

/**
 * Görselin formatını ve boyutunu doğrular.
 * @returns {{ ok:boolean, error?:string, size?:object }}
 */
export function validateImage(buffer, kind) {
  const size = readImageSize(buffer);
  if (!size) {
    return { ok: false, error: 'Görsel okunamadı. PNG, JPEG veya GIF kullan.' };
  }

  if (kind === 'avatar') {
    if (size.width < 128 || size.height < 128) {
      return {
        ok: false,
        error: `Avatar ${size.width}x${size.height}. Discord en az 128x128 istiyor (önerilen 512x512).`
      };
    }
    if (buffer.length > AVATAR_MAX_BYTES) {
      return {
        ok: false,
        error: `Avatar dosyası ${Math.round(buffer.length / 1024)} KB, sınır ${AVATAR_MAX_BYTES / 1024} KB. Görseli küçült veya sıkıştır.`
      };
    }
    return { ok: true, size };
  }

  /* Banner */
  if (size.width < BANNER_MIN_DIMENSION || size.height < 240) {
    return {
      ok: false,
      error: `Banner ${size.width}x${size.height} çok küçük. Discord en az ${BANNER_MIN_DIMENSION}x240 istiyor (önerilen 600x240 veya 1200x480).`
    };
  }
  if (buffer.length > BANNER_MAX_BYTES) {
    return {
      ok: false,
      error: `Banner dosyası ${(buffer.length / 1024 / 1024).toFixed(1)} MB, sınır ${BANNER_MAX_BYTES / 1024 / 1024} MB.`
    };
  }
  return { ok: true, size };
}

/* ------------------------------------------------------------------ *
 * Avatar (PP)
 * ------------------------------------------------------------------ */

/**
 * Botun avatarını değiştirir.
 * @param {import('discord.js').Client} client
 * @param {Buffer} buffer PNG/JPEG verisi
 * @returns {Promise<{ ok:boolean, error?:string }>}
 */
export async function setAvatar(client, buffer) {
  if (!buffer?.length) return { ok: false, error: 'Görsel verisi boş.' };
  if (buffer.length > AVATAR_MAX_BYTES) {
    return {
      ok: false,
      error: `Avatar ${Math.round(buffer.length / 1024)} KB, sınır ${AVATAR_MAX_BYTES / 1024} KB. Görseli küçült.`
    };
  }

  try {
    await client.user.setAvatar(buffer);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error, 'Avatar') };
  }
}

export async function removeAvatar(client) {
  try {
    await client.user.setAvatar(null);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error, 'Avatar') };
  }
}

/* ------------------------------------------------------------------ *
 * Banner
 * ------------------------------------------------------------------ */

/**
 * Botun bannerını değiştirir.
 * Discord banner için en az 600x240 piksel ister ve dosya 8 MB'ı geçemez.
 * @returns {Promise<{ ok:boolean, error?:string }>}
 */
export async function setBanner(client, buffer) {
  if (!buffer?.length) return { ok: false, error: 'Görsel verisi boş.' };
  if (buffer.length > BANNER_MAX_BYTES) {
    return {
      ok: false,
      error: `Banner ${Math.round(buffer.length / 1024 / 1024)} MB, sınır ${BANNER_MAX_BYTES / 1024 / 1024} MB.`
    };
  }

  try {
    await client.user.setBanner(buffer);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error, 'Banner') };
  }
}

export async function removeBanner(client) {
  try {
    await client.user.setBanner(null);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error, 'Banner') };
  }
}

/* ------------------------------------------------------------------ *
 * Oyun adı / etkinlik
 * ------------------------------------------------------------------ */

/**
 * Botun profil altındaki yazısını değiştirir.
 *
 * @param {Client} client
 * @param {object} options
 * @param {string} options.text     Görünecek metin ("Sunucunu koruyor")
 * @param {string} [options.type]   playing|watching|listening|competing|custom
 * @param {string} [options.state]  Custom tip için ek satır
 * @param {string} [options.status] online|idle|dnd|invisible
 */
export async function setActivity(client, { text, type = 'watching', status, state } = {}) {
  const activityType = ACTIVITY_TYPES[type] ?? ActivityType.Watching;
  const presence = { activities: [], status: status || undefined };

  if (text) {
    presence.activities.push({
      name: String(text).slice(0, 128),   // Discord limiti
      type: activityType
    });

    // Custom tipte ikinci satır eklenebilir.
    if (activityType === ActivityType.Custom && state) {
      presence.activities[0].state = String(state).slice(0, 128);
    }
  }

  try {
    await client.user.setPresence(presence);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error, 'Etkinlik') };
  }
}

/* ------------------------------------------------------------------ *
 * Yardımcılar
 * ------------------------------------------------------------------ */

/**
 * Discord hatalarını anlaşılır Türkçeye çevirir.
 * En sık hata: bot kendi profilini değiştirmek için OAuth2 `bot` scope'una sahip olmalı.
 */
function describe(error, label) {
  const code = error?.code || error?.rawError?.code;
  const message = error?.message || String(error);

  if (code === 50035 || /invalid form body/i.test(message)) {
    return `${label} reddedildi: görsel biçimi veya boyutu uygun değil. PNG/JPEG kullan, en az 512x512 (banner için 600x240).`;
  }
  if (code === 50013 || /missing permissions/i.test(message)) {
    return `${label} için yetki yok. Bot uygulamanın OAuth2 linkinde "bot" scope'u açık olmalı.`;
  }
  if (code === 30005 || /not a valid user token/i.test(message)) {
    return 'Bot token geçersiz. Developer Portal\'dan resetlemen gerekir.';
  }
  return `${label} güncellenemedi: ${message}`;
}

/** Mevcut profili okur (avatar/banner URL'leri ve etkinlik). */
export function getProfileInfo(client) {
  const user = client.user;
  if (!user) return null;

  return {
    tag: user.tag,
    username: user.username,
    displayName: user.globalName || user.username,
    id: user.id,
    avatarUrl: user.displayAvatarURL({ size: 512 }),
    hasBanner: Boolean(user.bannerURL()),
    bannerUrl: user.bannerURL({ size: 600 }),
    status: user.status,
    activities: user.activities.map((activity) => ({
      name: activity.name,
      type: ACTIVITY_LABELS[Object.keys(ACTIVITY_TYPES).find((key) => ACTIVITY_TYPES[key] === activity.type)] || 'Bilinmiyor'
    }))
  };
}

export { AVATAR_MAX_BYTES, BANNER_MAX_BYTES, BANNER_MIN_DIMENSION };
