/**
 * Yedekleme ve geri yükleme (Restore System).
 *
 * Wick'in yaklaşımı: düzenli aralıklarla sunucunun "anlık görüntüsü" alınır.
 * Nuke sonrası son geçerli yedeğin üzerine yüklenir; anlık görüntüyle
 * uyuşmayan her şey silinir, silinenler geri gelir.
 *
 * Not: Discord mesajları ve rol atamaları yedeklenmez (Discord API'si
 * bunları desteklemez). Kanallar, roller ve ayarlar yedeklenir.
 */
import { saveBackup, listBackups, readBackup } from './store.js';
import { sendGuardLog } from './guard-utils.js';

/** guildId -> { channels: [...], roles: [...], createdAt } son anlık görüntü (RAM) */
const liveImages = new Map();
let backupTimer = null;

/* ------------------------------------------------------------------ *
 * Anlık görüntü alma
 * ------------------------------------------------------------------ */

/**
 * Sunucunun anlık görüntüsünü alır (kanal + roller).
 * @returns {{ channels:Array, roles:Array, settings:object }}
 */
export function captureImage(guild, settings) {
  const image = {
    createdAt: Date.now(),
    guildId: guild.id,
    guildName: guild.name,
    channels: guild.channels.cache.map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      parentId: channel.parentId,
      position: channel.position,
      topic: channel.topic,
      nsfw: channel.nsfw,
      rateLimitPerUser: channel.rateLimitPerUser
    })),
    roles: guild.roles.cache.map((role) => ({
      id: role.id,
      name: role.name,
      color: role.color,
      hoist: role.hoist,
      position: role.position,
      permissions: role.permissions.bitfield.toString()
    })),
    settings: JSON.parse(JSON.stringify(settings))
  };

  liveImages.set(guild.id, image);
  return image;
}

export function getLiveImage(guildId) {
  return liveImages.get(guildId) || null;
}

/* ------------------------------------------------------------------ *
 * Yedekleme
 * ------------------------------------------------------------------ */

/**
 * Yedeği diske yazar ve loglar.
 * @returns {string|null} dosya adı
 */
export async function createBackup(client, guild, settings, reason = 'manuel') {
  const image = captureImage(guild, settings);
  try {
    const file = await saveBackup(guild.id, image, settings.backups?.keep ?? 20);
    await sendGuardLog(
      client,
      guild,
      '💾 Yedek oluşturuldu',
      `Sebep: ${reason}\nKanal: ${image.channels.length} | Rol: ${image.roles.length}\nDosya: ${file}`,
      0x5865f2
    );
    return file;
  } catch (error) {
    await sendGuardLog(client, guild, '❌ Yedek alınamadı', error.message, 0xed4245).catch(() => null);
    return null;
  }
}

/**
 * Düzenli yedekleme döngüsünü başlatır.
 * @returns {NodeJS.Timeout|null}
 */
export function startBackupScheduler(client, guild) {
  stopBackupScheduler(guild.id);

  const check = async () => {
    const { getGuildSettings } = await import('./guard-utils.js');
    const settings = getGuildSettings(client, guild.id);
    if (!settings.backups?.enabled) return;

    await createBackup(client, guild, settings, 'otomatik');
  };

  // 5 dakikada bir kontrol et, ayarlar değişmiş olabilir.
  backupTimer = setInterval(async () => {
    const { getGuildSettings } = await import('./guard-utils.js');
    const settings = getGuildSettings(client, guild.id);
    if (!settings.backups?.enabled) return;

    const interval = settings.backups.intervalMs ?? 10800000;
    const last = (await listBackups(guild.id))[0];
    if (!last || Date.now() - last.createdAt >= interval) {
      await createBackup(client, guild, settings, 'otomatik');
    }
  }, 300000);

  if (backupTimer.unref) backupTimer.unref();
  void check;
  return backupTimer;
}

export function stopBackupScheduler(guildId) {
  void guildId;
  if (backupTimer) {
    clearInterval(backupTimer);
    backupTimer = null;
  }
}

/* ------------------------------------------------------------------ *
 * Geri yükleme
 * ------------------------------------------------------------------ */

/**
 * Bir yedekten sunucuyu geri yükler.
 *
 * @param {object} options
 * @param {boolean} options.deleteUnknown  Görüntüde olmayan kanalları/rolleri sil
 * @param {boolean} options.restoreSettings Ayarları da geri yükle
 * @returns {Promise<object>} işlem özeti
 */
export async function restoreBackup(client, guild, file, options = {}) {
  const backup = await readBackup(guild.id, file);
  if (!backup) return { ok: false, error: 'Yedek okunamadı.' };

  const summary = {
    ok: true,
    channelsCreated: 0,
    channelsRenamed: 0,
    channelsDeleted: 0,
    rolesCreated: 0,
    rolesUpdated: 0,
    rolesDeleted: 0,
    settingsRestored: false,
    errors: []
  };

  /* --- Kanallar --- */
  const backupChannels = backup.channels || [];
  const backupChannelIds = new Set(backupChannels.map((c) => c.id));

  // 1) Yedekteki kanalları oluştur / düzelt.
  for (const data of backupChannels) {
    const existing = guild.channels.cache.get(data.id);

    if (!existing) {
      try {
        const created = await guild.channels.create({
          name: data.name,
          type: data.type,
          parent: data.parentId || undefined,
          topic: data.topic || undefined,
          nsfw: data.nsfw || undefined,
          rateLimitPerUser: data.rateLimitPerUser || undefined,
          reason: 'Guard geri yükleme: kanal yoktu'
        });
        summary.channelsCreated++;
        void created;
      } catch (error) {
        summary.errors.push(`Kanal "${data.name}" oluşturulamadı: ${error.message}`);
      }
      continue;
    }

    if (existing.name !== data.name) {
      try {
        await existing.setName(data.name, 'Guard geri yükleme: isim farkı');
        summary.channelsRenamed++;
      } catch (error) {
        summary.errors.push(`"${existing.name}" yeniden adlandırılamadı: ${error.message}`);
      }
    }
  }

  // 2) Yedekte olmayan kanalları sil (bot yönetemiyorsa atlanır).
  if (options.deleteUnknown) {
    for (const channel of guild.channels.cache.values()) {
      if (backupChannelIds.has(channel.id)) continue;
      if (channel.id === guild.systemChannelId) continue;
      if (!channel.manageable) continue;
      if (channel.id === guild.id) continue;

      try {
        await channel.delete('Guard geri yükleme: yedekte yoktu');
        summary.channelsDeleted++;
      } catch (error) {
        summary.errors.push(`"${channel.name}" silinemedi: ${error.message}`);
      }
    }
  }

  /* --- Roller --- */
  const backupRoles = (backup.roles || []).filter((r) => r.id !== guild.id);
  const backupRoleIds = new Set(backupRoles.map((r) => r.id));

  for (const data of backupRoles) {
    const existing = guild.roles.cache.get(data.id);

    if (!existing) {
      try {
        await guild.roles.create({
          name: data.name,
          color: data.color,
          hoist: data.hoist,
          permissions: BigInt(data.permissions),
          reason: 'Guard geri yükleme: rol yoktu'
        });
        summary.rolesCreated++;
      } catch (error) {
        summary.errors.push(`Rol "${data.name}" oluşturulamadı: ${error.message}`);
      }
      continue;
    }

    try {
      const currentPerms = existing.permissions.bitfield.toString();
      if (currentPerms !== data.permissions || existing.color !== data.color || existing.name !== data.name) {
        await existing.edit(
          {
            name: data.name,
            color: data.color,
            permissions: BigInt(data.permissions)
          },
          'Guard geri yükleme'
        );
        summary.rolesUpdated++;
      }
    } catch (error) {
      summary.errors.push(`Rol "${data.name}" güncellenemedi: ${error.message}`);
    }
  }

  if (options.deleteUnknown) {
    const me = guild.members.me;
    for (const role of guild.roles.cache.values()) {
      if (backupRoleIds.has(role.id)) continue;
      if (role.id === guild.id) continue;
      if (role.managed) continue;
      // Botun kendi rolü ve üstü: silinemez.
      if (me && me.roles.highest.comparePositionTo(role) <= 0) continue;

      try {
        await role.delete('Guard geri yükleme: yedekte yoktu');
        summary.rolesDeleted++;
      } catch (error) {
        summary.errors.push(`Rol "${role.name}" silinemedi: ${error.message}`);
      }
    }
  }

  /* --- Ayarlar --- */
  if (options.restoreSettings && backup.settings) {
    const { saveGuildSettings, getGuildSettings } = await import('./guard-utils.js');
    const current = getGuildSettings(client, guild.id);
    // Kritik alanlar korunur: acil durum ve kilit kendi akışıyla yönetiliyor.
    const merged = {
      ...backup.settings,
      emergencyMode: current.emergencyMode,
      lockdown: current.lockdown,
      panicMode: current.panicMode,
      enabled: current.enabled
    };
    await saveGuildSettings(client, guild.id, merged);
    summary.settingsRestored = true;
  }

  await sendGuardLog(
    client,
    guild,
    '♻️ Geri yükleme tamamlandı',
    [
      `Kanal: +${summary.channelsCreated} oluşturuldu, ${summary.channelsRenamed} yeniden adlandırıldı, ${summary.channelsDeleted} silindi`,
      `Rol: +${summary.rolesCreated} oluşturuldu, ${summary.rolesUpdated} güncellendi, ${summary.rolesDeleted} silindi`,
      `Ayarlar: ${summary.settingsRestored ? 'geri yüklendi' : 'değiştirilmedi'}`,
      summary.errors.length ? `\nHatalar: ${summary.errors.length}` : ''
    ].filter(Boolean).join('\n'),
    summary.errors.length ? 0xfaa61a : 0x57f287
  );

  return summary;
}

/**
 * Panik modu sırasında otomatik geri yükleme.
 */
export async function autoRestoreAfterPanic(client, guild, settings) {
  if (!settings.backups?.autoRestoreOnPanic) return null;

  const backups = await listBackups(guild.id);
  if (!backups.length) return null;

  const latest = backups[0];

  // Çok eski yedekleri geri yüklemek daha fazla hasar verir.
  const age = Date.now() - latest.createdAt;
  if (age > 24 * 60 * 60 * 1000) {
    await sendGuardLog(
      client,
      guild,
      '⚠️ Otomatik geri yükleme yapılmadı',
      `En son yede ${Math.round(age / 3600000)} saat önce alınmış. Eski yedekle geri yüklemek hasarı artırabilir. Dashboard > Yedekler bölümünden elle yapabilirsin.`,
      0xfaa61a
    );
    return null;
  }

  return restoreBackup(client, guild, latest.file, {
    deleteUnknown: true,
    restoreSettings: false
  });
}
