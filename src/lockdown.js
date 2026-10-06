/**
 * Kilit modu (lockdown): tüm metin kanallarına @everyone için yazma izni kaldırılır.
 *
 * ÖNEMLİ: Orijinal kod @everyone overwrite'ını `null` ile "devral" yapıyordu,
 * bu da sunucunun gerçek izin ayarlarını yok ediyordu ve kilit açıldığında
 * eski hali geri gelmiyordu. Burada kanal başına orijinal izin snapshot'ı
 * alınıyor ve aynen geri yükleniyor.
 */
import { sendGuardLog } from './guard-utils.js';

/** guildId -> Map<channelId, { mode, overwrites: Array<[string, any]> }> */
const snapshots = new Map();

/**
 * @returns {{ locked:number, failed:number }}
 */
export async function lockAllChannels(client, guild, reason) {
  let locked = 0;
  let failed = 0;
  const map = new Map();

  const channels = guild.channels.cache.filter((channel) => channel.isTextBased());
  for (const channel of channels.values()) {
    // Botun yönetmediği kanallara dokunma.
    if (!channel.manageable) {
      failed++;
      continue;
    }

    // İlk kilitte snapshot al. Zaten kilitliyse mevcut snapshot'ı koru.
    if (!map.has(channel.id)) {
      map.set(channel.id, {
        mode: channel.permissionOverwrites.editMode,
        overwrites: channel.permissionOverwrites.cache.map((overwrite) => [
          overwrite.id,
          overwrite.allow.bitfield.toString(),
          overwrite.deny.bitfield.toString()
        ])
      });
    }

    try {
      // Mevcut overwrite'ı değiştirmek yerine @everyone'a deny ekle.
      const existing = channel.permissionOverwrites.cache.get(guild.roles.everyone.id);
      const currentAllow = existing?.allow?.bitfield ?? 0n;
      const currentDeny = existing?.deny?.bitfield ?? 0n;

      await channel.permissionOverwrites.edit(
        guild.roles.everyone,
        {
          SendMessages: false,
          AddReactions: false,
          SendMessagesInThreads: false,
          CreatePublicThreads: false,
          CreatePrivateThreads: false
        },
        { reason: `Guard kilit: ${reason}` }
      );

      // Geri almak için mevcut bitfield'ları sakla.
      const snapshot = map.get(channel.id);
      snapshot.overwrites = snapshot.overwrites.map(([id, allow, deny]) => {
        if (id === guild.roles.everyone.id) {
          return [id, currentAllow.toString(), currentDeny.toString()];
        }
        return [id, allow, deny];
      });

      locked++;
    } catch {
      failed++;
    }
  }

  snapshots.set(guild.id, map);
  return { locked, failed };
}

/**
 * Kaldırılan izinleri orijinal hâline döndürür.
 * @returns {{ unlocked:number, failed:number }}
 */
export async function unlockAllChannels(client, guild, reason) {
  const map = snapshots.get(guild.id);
  let unlocked = 0;
  let failed = 0;

  const channels = guild.channels.cache.filter((channel) => channel.isTextBased());
  for (const channel of channels.values()) {
    const snapshot = map?.get(channel.id);
    if (!snapshot || !channel.manageable) continue;

    try {
      // Önce overwrite listesini tamamen sıfırla, sonra orijinalini geri yükle.
      await channel.permissionOverwrites.edit(
        [...channel.permissionOverwrites.cache.values()],
        { reason: `Guard kilit açma: ${reason}` }
      );
      await channel.permissionOverwrites.edit(
        snapshot.overwrites.map(([id, allow, deny]) => [id, BigInt(allow), BigInt(deny)]),
        { reason: `Guard kilit açma: ${reason}` }
      );
      unlocked++;
    } catch {
      failed++;
    }
  }

  snapshots.delete(guild.id);
  return { unlocked, failed };
}

export function isLocked(guildId) {
  return snapshots.has(guildId);
}

export function getSnapshotCount(guildId) {
  return snapshots.get(guildId)?.size ?? 0;
}

/** Eski kodun kullandığı arayüz (aynı imzayla). */
export async function triggerLockdown(client, guild) {
  const { getGuildSettings, saveGuildSettings } = await import('./guard-utils.js');
  const settings = getGuildSettings(client, guild.id);
  settings.lockdown = true;
  await saveGuildSettings(client, guild.id, settings);

  const result = await lockAllChannels(client, guild, 'acil kilit');
  await sendGuardLog(
    client,
    guild,
    '🚨 Kilit modu açıldı',
    `${result.locked} kanal kilitlendi${result.failed ? `, ${result.failed} kanal atlandı` : ''}.`,
    0xed4245
  );
  return result;
}

export async function releaseLockdown(client, guild) {
  const { getGuildSettings, saveGuildSettings } = await import('./guard-utils.js');
  const settings = getGuildSettings(client, guild.id);
  settings.lockdown = false;
  await saveGuildSettings(client, guild.id, settings);

  const result = await unlockAllChannels(client, guild, 'kilit açma');
  await sendGuardLog(
    client,
    guild,
    '✅ Kilit modu kapatıldı',
    `${result.unlocked} kanalın izinleri geri yüklendi${result.failed ? `, ${result.failed} kanal atlandı` : ''}.`,
    0x57f287
  );
  return result;
}
