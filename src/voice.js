/**
 * Ses kanalı yönetimi — bot bir kanalda sabit bekler.
 *
 * ÖNEMLİ SINIR: Discord botları ses akışına erişemez. Bot kanala girer,
 * kanal listesinde görünür olur ve kimin hangi kanalda olduğunu biliriz;
 * ama konuşmaları duyamaz, kaydedemez, anlayamaz.
 *
 * Bu yüzden bot her zaman kendini susturur ve sağırlaştırır (selfMute /
 * selfDeaf). Aksi halde kanalda gereksiz ses çıkarırdı.
 */
import { Events } from 'discord.js';

/* discord.js v14'te ses bağlantısı ayrı paketten geliyor.
   @discordjs/voice discord.js'e BAĞIMLILIK DEĞİL, ayrıca kurulmalı:
     npm install @discordjs/voice
   package.json'a eklendi. */
import {
  joinVoiceChannel as joinVoiceConnection,
  VoiceConnectionStatus
} from '@discordjs/voice';

/** guildId -> { connection, channelId, joinedAt, reconnects } */
const connections = new Map();

/* ------------------------------------------------------------------ *
 * Durum
 * ------------------------------------------------------------------ */

/**
 * Bağlantının "Ready" olmasını bekler.
 *
 * @param {object} connection  @discordjs/voice bağlantı nesnesi
 * @param {number} timeoutMs
 * @returns {Promise<boolean>} hazırsa true, zaman aşımı veya hata durumunda false
 */
function waitForReady(connection, timeoutMs = 15000) {
  return new Promise((resolve) => {
    if (!connection || typeof connection.on !== 'function') {
      resolve(false);
      return;
    }

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { connection.off?.('stateChange', onChange); } catch { /* yoksay */ }
      resolve(value);
    };

    const onChange = (oldState, newState) => {
      if (newState?.status === VoiceConnectionStatus.Ready) finish(true);
      if (newState?.status === VoiceConnectionStatus.Destroyed) finish(false);
      if (newState?.status === VoiceConnectionStatus.Signalling && oldState?.status === VoiceConnectionStatus.Disconnected) {
        /* Discord bizi attı */
        finish(false);
      }
    };

    const timer = setTimeout(() => finish(false), timeoutMs);

    /* Zaten hazırsa gecikmeden dön. */
    if (connection.state?.status === VoiceConnectionStatus.Ready) {
      finish(true);
      return;
    }
    if (connection.state?.status === VoiceConnectionStatus.Destroyed) {
      finish(false);
      return;
    }

    connection.on('stateChange', onChange);
  });
}

export function getVoiceState(guildId) {
  return connections.get(guildId) || null;
}

export function isInVoice(guildId) {
  return connections.has(guildId);
}

export function getActiveGuilds() {
  return [...connections.keys()];
}

/* ------------------------------------------------------------------ *
 * Katılma / ayrılma
 * ------------------------------------------------------------------ */

/**
 * Botu bir ses kanalına sokar.
 *
 * @param {import('discord.js').Client} client  Discord istemcisi (ses bağlantısı istemci üzerinden kurulur)
 * @param {import('discord.js').Guild} guild
 * @param {string} channelId
 * @param {object} options
 * @returns {{ ok:boolean, error?:string, rejoining?:boolean }}
 */
export async function joinVoiceChannel(client, guild, channelId, options = {}) {
  const selfMute = options.selfMute !== false;
  const selfDeaf = options.selfDeaf !== false;

  if (!channelId) return { ok: false, error: 'Ses kanalı seçilmedi.' };

  if (!guild) return { ok: false, error: 'Sunucu bulunamadı.' };
  if (!client) return { ok: false, error: 'Bot istemcisi bulunamadı.' };

  const channel = guild.channels.cache.get(channelId);
  if (!channel) return { ok: false, error: 'Ses kanalı bulunamadı (silinmiş olabilir).' };

  /* Kanal gerçekten ses kanalı mı?
     ÖNEMLİ: discord.js v14'te channel.join() KALDIRILDI ve
     guild.voiceStates.create() de kaldırıldı. Doğru yol
     client.joinVoiceChannel() (discord.js'in @discordjs/voice
     eklentisinden dışa aktardığı fonksiyon).
     Eski API'leri kontrol etmek her zaman "ses kanalı değil" ya da
     "create is not a function" hatası veriyordu. */
  const isVoice = channel.type === 2 ||
    channel.type === 13 ||          // sesli sahne
    (typeof channel.isVoiceBased === 'function' && channel.isVoiceBased() && !channel.isDMBased?.());

  if (!isVoice) {
    return { ok: false, error: 'Bu kanal bir ses kanalı değil. Paneldeki ses kanalı listesinden seç.' };
  }

  const existing = connections.get(guild.id);

  /* Zaten aynı kanaldaysak bağlantıyı bozmayız. */
  if (existing?.channelId === channelId) {
    const status = existing.connection?.state?.status;
    if (status === VoiceConnectionStatus.Ready || status === VoiceConnectionStatus.Connecting) {
      return { ok: true, rejoining: true };
    }
    try {
      existing.connection?.rejoin?.();
      return { ok: true, rejoining: true };
    } catch { /* yeniden kurulum aşağıda yapılacak */ }
  }

  /* Başka kanaldaysak önce çık. */
  if (existing) {
    await destroyConnection(guild, 'kanal değişti');
  }

  /* Kanal görünür değilse ya da bağlanma yetkisi yoksa erken çık. */
  const me = guild.members?.me;
  if (me?.permissions?.has?.('Connect') === false) {
    return { ok: false, error: 'Botun "Bağlan" (Connect) yetkisi yok.' };
  }

  /* discord.js v14'te guild.voiceStates.create() KALDIRILDI. Doğru yol
     @discordjs/voice paketindeki joinVoiceChannel(client, ...). */
  try {
    if (typeof joinVoiceConnection !== 'function') {
      return {
        ok: false,
        error: '@discordjs/voice paketi eksik. Terminalde "npm install @discordjs/voice" çalıştır.'
      };
    }

    /* Doğru kullanım (discord.js guide):
       joinVoiceChannel({ channelId, guildId, adapterCreator })
     adapterCreator olmadan "options.adapterCreator is not a function"
     hatası veriyor. discord.js bunu guild.voiceAdapterCreator ile sağlar. */
    const adapterCreator = guild.voiceAdapterCreator;
    if (typeof adapterCreator !== 'function') {
      return {
        ok: false,
        error: 'Ses bağlantısı kurulamadı: sunucu ses adaptörü hazır değil. GuildVoiceStates intent\'i açık olmalı.'
      };
    }

    const connection = joinVoiceConnection({
      channelId,
      guildId: guild.id,
      selfDeaf,
      selfMute,
      adapterCreator
    });

    /* joinVoiceChannel SENKRON çağrıdır: bağlantı nesnesini hemen
       döndürür, "Ready" olması saniyeler alabilir. Kullanıcıya
       "bağlandı" deyip başarısız olmamak için Ready'yi bekliyoruz. */
    const ready = await waitForReady(connection, 15000);

    if (!ready) {
      const status = connection.state?.status || 'bilinmiyor';
      try { connection.destroy(); } catch { /* yoksay */ }
      return {
        ok: false,
        error: `Ses bağlantısı kurulamadı (durum: ${status}). Botun "Bağlan" yetkisi ve GuildVoiceStates intent'i kontrol edilmeli.`,
        status
      };
    }

    connections.set(guild.id, {
      connection,
      channelId,
      joinedAt: Date.now(),
      reconnects: 0,
      selfMute,
      selfDeaf
    });

    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeError(error) };
  }
}

/**
 * Botu ses kanalından çıkarır.
 */
export async function leaveVoiceChannel(guild, reason = 'manuel') {
  const entry = connections.get(guild.id);
  if (!entry) return { ok: true, alreadyLeft: true };

  await destroyConnection(guild, reason);
  return { ok: true, left: true };
}

async function destroyConnection(guild, reason) {
  const entry = connections.get(guild.id);
  connections.delete(guild.id);
  if (!entry) return;

  try {
    if (entry.connection && typeof entry.connection.destroy === 'function') {
      entry.connection.destroy();
    }
  } catch {
    /* bağlantı zaten ölmüş olabilir */
  }
  void guild;
  void reason;
}

/* ------------------------------------------------------------------ *
 * Olay yönetimi
 * ------------------------------------------------------------------ */

/**
 * Botun kanalından atılmasını engeller veya geri bağlanmayı dener.
 * Discord bağlantıyı koparırsa bu devreye girer.
 */
export function handleVoiceStateUpdate(client, oldState, newState) {
  const guildId = newState?.guild?.id;
  if (!guildId) return;

  const entry = connections.get(guildId);
  if (!entry) return;

  /* Bot kendi durumunu güncellediyse (atıldıysa geri dönüyoruz). */
  if (newState.id === newState.client?.user?.id) {
    if (newState.channelId === null) {
      // Kanal dışına itildi: kısa süre sonra geri bağlanmayı dene.
      entry.reconnects = (entry.reconnects || 0) + 1;
      if (entry.reconnects > 5) {
        connections.delete(guildId);
        return;
      }
      setTimeout(() => {
        const current = connections.get(guildId);
        if (!current) return;
        joinVoiceChannel(client, newState.guild, current.channelId, {
          selfMute: current.selfMute,
          selfDeaf: current.selfDeaf
        }).catch(() => null);
      }, 4000);
    } else if (newState.channelId !== entry.channelId) {
      // Başka kanala taşındı: ayarı güncelle.
      entry.channelId = newState.channelId;
    }
  }
}

/** Kanal silinirse bağlantıyı kapat. */
export function handleChannelDelete(channel) {
  const guildId = channel?.guild?.id;
  if (!guildId) return;

  const entry = connections.get(guildId);
  if (entry?.channelId !== channel.id) return;

  connections.delete(guildId);
  try {
    entry.connection?.destroy?.();
  } catch { /* yoksay */ }
}

/** Sunucudan ayrılınca temizle. */
export function handleGuildDelete(guild) {
  const entry = connections.get(guild?.id);
  if (!entry) return;
  connections.delete(guild.id);
  try {
    entry.connection?.destroy?.();
  } catch { /* yoksay */ }
}

/* ------------------------------------------------------------------ *
 * Yardımcılar
 * ------------------------------------------------------------------ */

function describeError(error) {
  const code = error?.code;
  const message = error?.message || String(error);

  if (code === 40001 || /Missing Access/i.test(message)) {
    return 'Botun ses kanalına girme yetkisi yok veya kanal görünmez. Bot rolünü yukarı taşı.';
  }
  if (code === 4014 || /voice|Gateway/i.test(message)) {
    return 'Ses bağlantısı kurulamadı. Bot için Voice/Speak izni gerekebilir.';
  }
  if (/Missing Permissions/i.test(message)) {
    return 'Botun "Bağlan" (Connect) yetkisi yok.';
  }
  return `Ses bağlantısı kurulamadı: ${message}`;
}

/**
 * Sunucudaki ses kanallarını listeler (panel seçimi için).
 * @returns {Array<{id:string, name:string, members:number, bitrate:number, userLimit:number}>}
 */
export function listVoiceChannels(guild, botMember) {
  return guild.channels.cache
    .filter((channel) => channel.type === CHANNEL_TYPE.voice || channel.type === CHANNEL_TYPE.stageVoice)
    .map((channel) => {
      let members = 0;
      try {
        members = channel.members?.size ?? 0;
      } catch {
        // Üye listesi yoksa (cache eksik) 0 kabul ediliyor.
        members = 0;
      }

      let userLimit = 0;
      try {
        userLimit = channel.userLimit ?? 0;
      } catch {
        userLimit = 0;
      }

      return {
        id: channel.id,
        name: channel.name,
        members,
        userLimit,
        full: Boolean(userLimit && members >= userLimit),
        manageable: channel.manageable ?? true,
        botCanConnect: botMember?.permissions?.has?.('Connect') ?? false
      };
    })
    .sort((a, b) => b.members - a.members);
}

/** Kanal adı çözümlemesi: kullanıcı isimle yazabilir. */
export function resolveVoiceChannelId(guild, input) {
  if (!input) return '';
  const value = String(input).trim();

  const byId = guild.channels.cache.get(value);
  if (byId && (byId.type === CHANNEL_TYPE.voice || byId.type === CHANNEL_TYPE.stageVoice)) {
    return byId.id;
  }

  const byName = guild.channels.cache.find((channel) =>
    (channel.type === CHANNEL_TYPE.voice || channel.type === CHANNEL_TYPE.stageVoice) &&
    channel.name.toLowerCase() === value.toLowerCase()
  );
  return byName?.id || '';
}

/* --- Discord kanal tipleri (GuildChannelType) --- */
const CHANNEL_TYPE = {
  text: 0,
  voice: 2,          // ses kanalı
  category: 4,
  stageVoice: 13,    // sesli sahne
  thread: 11,
  forum: 15
};

export { CHANNEL_TYPE, Events };
