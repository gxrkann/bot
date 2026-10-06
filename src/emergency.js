/**
 * Acil durum modu: tüm rollerden yönetici iznini kaldırır.
 *
 * ÖNEMLİ (eski davranış): Anlık görüntü RAM'de tutuluyordu. Bot yeniden
 * başlasa bile geri alınmadığı için sunucu kalıcı olarak yönetilemez hale
 * geliyordu — geri almak için elle müdahale gerekiyordu.
 *
 * Burada snapshot `settings.json`'a yazılıyor. Bot çökse bile roller
 * dashboard üzerinden geri yüklenebiliyor.
 */
import { PermissionFlagsBits } from 'discord.js';
import { sendGuardLog } from './guard-utils.js';

/** guildId -> Map<roleId, bitfield> (RAM, hızlı erişim için) */
const memorySnapshots = new Map();

export function hasSnapshot(guildId) {
  return memorySnapshots.has(guildId);
}

/**
 * Acil durum modunu açar.
 * @returns {{ stripped:number, failed:number }}
 */
export async function enableEmergencyMode(client, guild) {
  const { getGuildSettings, saveGuildSettings } = await import('./store.js');
  const settings = getGuildSettings(client, guild.id);

  const snapshots = {};
  let stripped = 0;
  let failed = 0;

  for (const role of guild.roles.cache.values()) {
    if (!role.permissions?.has(PermissionFlagsBits.Administrator)) continue;
    // @everyone ve botun kendi rolü dokunulmaz.
    if (role.id === guild.id) continue;
    if (role.managed) continue;

    snapshots[role.id] = role.permissions.bitfield.toString();

    try {
      await role.setPermissions(
        role.permissions.remove(PermissionFlagsBits.Administrator),
        { reason: 'Guard acil durum modu' }
      );
      stripped++;
    } catch {
      failed++;
    }
  }

  memorySnapshots.set(guild.id, new Map(
    Object.entries(snapshots).map(([id, bits]) => [id, bits])
  ));

  settings.emergencyMode = true;
  settings.emergencySnapshots = snapshots;
  await saveGuildSettings(client, guild.id, settings);

  await sendGuardLog(
    client,
    guild,
    '🚨 Acil durum modu aktif',
    `${stripped} rolden yönetici izni kaldırıldı${failed ? `, ${failed} rol atlandı` : ''}.\n\n` +
    'Geri almak için Dashboard > Acil Durum bölümünü kullan.',
    0xed4245
  );

  return { stripped, failed };
}

/**
 * Acil durum modunu kapatır ve izinleri geri yükler.
 * @returns {{ restored:number, failed:number }}
 */
export async function disableEmergencyMode(client, guild) {
  const { getGuildSettings, saveGuildSettings } = await import('./store.js');
  const settings = getGuildSettings(client, guild.id);

  const snapshots = settings.emergencySnapshots || Object.fromEntries(memorySnapshots.get(guild.id) || []);

  let restored = 0;
  let failed = 0;

  for (const [roleId, bitfield] of Object.entries(snapshots)) {
    const role = guild.roles.cache.get(roleId);
    if (!role) continue;

    try {
      await role.edit({ permissions: BigInt(bitfield) }, 'Guard acil durum modu kapatıldı');
      restored++;
    } catch {
      failed++;
    }
  }

  memorySnapshots.delete(guild.id);

  settings.emergencyMode = false;
  delete settings.emergencySnapshots;
  await saveGuildSettings(client, guild.id, settings);

  await sendGuardLog(
    client,
    guild,
    '✅ Acil durum modu kapatıldı',
    `${restored} rolün izinleri geri yüklendi${failed ? `, ${failed} rol geri yüklenemedi` : ''}.`,
    0x57f287
  );

  return { restored, failed };
}

/** Acil durumda mı kontrol eder. */
export function isEmergencyActive(settings) {
  return Boolean(settings.emergencyMode);
}

export function getSnapshotRoleCount(guildId, settings) {
  return Object.keys(settings?.emergencySnapshots || memorySnapshots.get(guildId) || {}).length;
}
