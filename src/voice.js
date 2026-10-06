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

/** guildId -> { connection, channelId, joinedAt, reconnects } */
const connections = new Map();

/* ------------------------------------------------------------------ *
 * Durum
 * ------------------------------------------------------------------ */

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
 * @param {import('discord.js').Guild} guild
 * @param {string} channelId
 * @param {object} options
 * @returns {{ ok:boolean, error?:string, rejoining?:boolean }}
 */
export async function joinVoiceChannel(guild, channelId, options = {}) {
  const selfMute = options.selfMute !== false;
  const selfDeaf = options.selfDeaf !== false;

  if (!channelId) return { ok: false, error: 'Ses kanalı seçilmedi.' };

  const channel = guild.channels.cache.get(channelId);
  if (!channel) return { ok: false, error: 'Ses kanalı bulunamadı (silinmiş olabilir).' };

  /* discord.js ses bağlantısını yalnızca metin/voice kanalı üzerinden kurar. */
  if (typeof channel.join !== 'function') {
    return { ok: false, error: 'Bu kanal bir ses kanalı değil.' };
  }

  const existing = connections.get(guild.id);

  /* Zaten aynı kanaldaysak bağlantıyı bozmayız. */
  if (existing?.channelId === channelId) {
    if (existing.connection.reconnecting || existing.connection.state.status !== 'Ready') {
      try {
        existing.connection.rejoin();
        return { ok: true, rejoining: true };
      } catch { /* yeniden kurulum aşağıda yapılacak */ }
    }
    return { ok: true, rejoining: true };
  }

  /* Başka kanaldaysak önce çık. */
  if (existing) {
    await destroyConnection(guild, 'kanal değişti');
  }

  /* discord.js v14 önerilen yol: guild.voiceStates.create(). */
  try {
    const connection = guild.voiceStates
      ? await guild.voiceStates.create({ channelId, selfDeaf, selfMute })
      : null;

    if (!connection) {
      return {
        ok: false,
        error: 'Bu sunucuda ses bağlantısı kurulamadı. Bot için Voice Gateway yetkisi gerekebilir.'
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

    /* Bağlantı düştüğünde haberdar olalım. */
    if (typeof connection.on === 'function') {
      connection.on('stateChange', (oldState, newState) => {
        if (newState.status === 'Disconnected') {
          const entry = connections.get(guild.id);
          if (entry) entry.connection = connection;
        }
      });
    }

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
export function handleVoiceStateUpdate(oldState, newState) {
  const guildId = newState?.guild?.id;
  if (!guildId) return;

  const entry = connections.get(guildId);
  if (!entry) return;

  /* Bot kendi durumunu güncellediyse (atıldıysa geri dönüyoruz). */
  if (newState.id === newState.client.user?.id) {
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
        joinVoiceChannel(newState.guild, current.channelId, {
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
    .filter((channel) => channel.type === 2)   // 2 = ses kanalı
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
  if (byId?.type === 2) return byId.id;

  const byName = guild.channels.cache.find((channel) =>
    channel.type === 2 && channel.name.toLowerCase() === value.toLowerCase()
  );
  return byName?.id || '';
}

export { Events };
