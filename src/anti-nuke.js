/**
 * Anti-Nuke: hız tabanlı limitler, karantina (quarantine) ve panik modu.
 *
 * Wick'teki yaklaşım: saldırı fark edildiğinde sunucu kilitlenir ve saldırganlar
 * karantinelenir (rolü kaldırılır). Yönetici yetkisi olmayan biri bir kez bile
 * rol silse izole edilir.
 *
 * Burada karantina, bir rol verilerek uygulanır: karantina rolü hiçbir kanalda
 * izin taşımadığı için üye hiçbir şey yapamaz. Bot yetkisi yeterli olduğu sürece
 * geri alınabilir.
 */
import { AuditLogEvent, PermissionFlagsBits } from 'discord.js';
import { isProtectedTarget, sendGuardLog } from './guard-utils.js';

/** guildId -> Map<actionType, number[]> son eylem zamanları */
const actionLog = new Map();
/** guildId -> Set<userId> karantineli üyeler */
const quarantined = new Map();

/* ------------------------------------------------------------------ *
 * Limit takibi
 * ------------------------------------------------------------------ */

const MINUTE = 60000;

/**
 * Bir eylemi kaydeder ve limit aşıldıysa true döner.
 * Hem dakika hem saat limiti kontrol edilir.
 */
export function recordAction(guildId, actionType, settings) {
  const limits = settings.antiNuke;
  if (!limits.enabled) return false;

  if (!actionLog.has(guildId)) actionLog.set(guildId, new Map());
  const map = actionLog.get(guildId);
  if (!map.has(actionType)) map.set(actionType, []);
  const list = map.get(actionType);

  const now = Date.now();
  list.push(now);

  // Yalnızca son bir saatı tutmak yeterli (saat limiti en büyük pencere).
  const hourAgo = now - 60 * MINUTE;
  while (list.length && list[0] < hourAgo) list.shift();

  const minuteCount = list.filter((t) => t >= now - MINUTE).length;
  const hourCount = list.length;

  const minuteLimit = limits.minuteLimit?.[actionType];
  const hourLimit = limits.hourLimit?.[actionType];

  if (minuteLimit && minuteCount > minuteLimit) return true;
  if (hourLimit && hourCount > hourLimit) return true;
  return false;
}

export function getActionCounts(guildId) {
  const map = actionLog.get(guildId);
  if (!map) return {};
  const now = Date.now();
  const result = {};
  for (const [type, list] of map.entries()) {
    result[type] = {
      minute: list.filter((t) => t >= now - MINUTE).length,
      hour: list.filter((t) => t >= now - 60 * MINUTE).length
    };
  }
  return result;
}

export function resetActionCounts(guildId) {
  actionLog.delete(guildId);
}

/* ------------------------------------------------------------------ *
 * Karantina
 * ------------------------------------------------------------------ */

export function isQuarantined(guildId, userId) {
  return quarantined.get(guildId)?.has(userId) ?? false;
}

export function getQuarantined(guildId) {
  return [...(quarantined.get(guildId) || [])];
}

function markQuarantined(guildId, userId) {
  if (!quarantined.has(guildId)) quarantined.set(guildId, new Set());
  quarantined.get(guildId).add(userId);
}

function unmarkQuarantined(guildId, userId) {
  quarantined.get(guildId)?.delete(userId);
}

/**
 * Bir üyeyi karantina rolüyle izole eder.
 * @returns {'quarantined'|'skipped'|'failed'}
 */
export async function quarantineMember(client, guild, member, reason) {
  const settings = client.guardSettings ? (await getSettings(client, guild.id)) : null;
  const antiNuke = settings?.antiNuke;
  if (!antiNuke?.enabled) return 'skipped';

  // Beyaz listedekiler ve bot sahipleri karantinelenmez.
  if (isProtectedTarget(guild, member, settings, client)) return 'skipped';

  const roleId = settings.quarantineRoleId;
  if (!roleId) return 'failed';

  const role = guild.roles.cache.get(roleId);
  if (!role) return 'failed';

  // Bot rolü veremiyorsa (yetki sırası) hiçbir şey yapmaya çalışma.
  if (!guild.members.me?.roles.highest.comparePositionTo(role) > 0) return 'failed';

  try {
    // Önce tüm rollerini kaldır, sonra karantina rolünü ver.
    await member.roles.set([role], `Karantina: ${reason}`);
    markQuarantined(guild.id, member.id);
    return 'quarantined';
  } catch {
    return 'failed';
  }
}

export async function releaseMember(client, guild, member) {
  const settings = await getSettings(client, guild.id);
  const roleId = settings.quarantineRoleId;
  const role = roleId ? guild.roles.cache.get(roleId) : null;
  try {
    if (role) await member.roles.remove(role, 'Karantina kaldırıldı');
    unmarkQuarantined(guild.id, member.id);
    return true;
  } catch {
    return false;
  }
}

/** Tüm karantineli üyeleri serbest bırakır. */
export async function releaseAll(client, guild) {
  const settings = await getSettings(client, guild.id);
  const role = settings.quarantineRoleId ? guild.roles.cache.get(settings.quarantineRoleId) : null;
  if (!role) return 0;
  let count = 0;
  for (const userId of getQuarantined(guild.id)) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      unmarkQuarantined(guild.id, userId);
      continue;
    }
    if (await releaseMember(client, guild, member)) count++;
  }
  return count;
}

/* ------------------------------------------------------------------ *
 * Panik modu
 * ------------------------------------------------------------------ */

let panicTimer = null;

/**
 * Panik modu: sunucuyu kilitler, uyarı rollerini pingler, saldırganları karantineler.
 * @returns {{ locked:boolean, quarantined:number, durationMs:number }}
 */
export async function triggerPanicMode(client, guild, reason, options = {}) {
  const settings = await getSettings(client, guild.id);
  const panic = settings.antiNuke?.panic;
  if (!panic?.enabled) return { locked: false, quarantined: 0, durationMs: 0 };

  settings.panicMode = true;
  await saveSettings(client, guild.id, settings);

  let locked = false;
  if (panic.lockServer) {
    const { lockAllChannels, unlockAllChannels } = await import('./lockdown.js');
    locked = await lockAllChannels(client, guild, `Panik modu: ${reason}`);
  }

  let quarantinedCount = 0;
  if (panic.quarantineRaiders) {
    for (const userId of options.raiderIds || []) {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) continue;
      if (await quarantineMember(client, guild, member, `Panik modu: ${reason}`) === 'quarantined') {
        quarantinedCount++;
      }
    }
  }

  // Uyarı rollerini pingle.
  if (panic.warnRoleIds?.length) {
    const channel = settings.logChannelId ? guild.channels.cache.get(settings.logChannelId) : null;
    if (channel) {
      await channel.send({
        content: panic.warnRoleIds.map((id) => `<@&${id}>`).join(' '),
        embeds: [{
          title: '🚨 PANİK MODU AKTİF',
          description: reason,
          color: 0xed4245,
          fields: [
            { name: 'Kilit', value: locked ? 'Açık' : 'Kapalı', inline: true },
            { name: 'Karantine', value: String(quarantinedCount), inline: true },
            { name: 'Süre', value: formatDuration(panic.durationMs), inline: true }
          ]
        }]
      }).catch(() => null);
    }
  }

  if (panic.autoUnlock && !panicTimer) {
    panicTimer = setTimeout(async () => {
      panicTimer = null;
      await stopPanicMode(client, guild).catch(() => null);
    }, panic.durationMs);
    if (panicTimer.unref) panicTimer.unref();
  }

  return { locked, quarantined: quarantinedCount, durationMs: panic.durationMs };
}

export async function stopPanicMode(client, guild) {
  const settings = await getSettings(client, guild.id);
  settings.panicMode = false;
  await saveSettings(client, guild.id, settings);

  if (panicTimer) {
    clearTimeout(panicTimer);
    panicTimer = null;
  }

  if (settings.lockdown) {
    const { unlockAllChannels } = await import('./lockdown.js');
    await unlockAllChannels(client, guild, 'Panik modu bitti');
  }

  const released = await releaseAll(client, guild);
  await sendGuardLog(client, guild, '✅ Panik modu bitti', `Karantine kaldırılan: ${released}`, 0x57f287);
  return { released };
}

/* ------------------------------------------------------------------ *
 * Olay işleyicileri
 * ------------------------------------------------------------------ */

/**
 * Bir yönetici eylemini denetler. Limit aşıldıysa saldırganı karantineler.
 * @returns {boolean} eylem izleniyorsa true
 */
export async function inspectAction(client, guild, actionType, targetId, auditEvent) {
  const settings = await getSettings(client, guild.id);
  const antiNuke = settings.antiNuke;
  if (!antiNuke?.enabled) return false;

  const triggered = recordAction(guild.id, actionType, settings);
  if (!triggered) return true;

  const actorId = await getExecutorId(guild, auditEvent, targetId);
  if (!actorId || actorId === client.user.id) return true;

  const member = await guild.members.fetch(actorId).catch(() => null);
  if (!member) return true;

  const counts = getActionCounts(guild.id);
  const detail = Object.entries(counts)
    .map(([type, c]) => `${type}: ${c.minute}/dk ${c.hour}/sa`)
    .join('\n');

  await sendGuardLog(
    client,
    guild,
    '🛑 Anti-Nuke limiti aşıldı',
    `Eylem: ${actionType}\nSaldırgan: ${member.user.tag} (<@${actorId}>)\n\n${detail}`,
    0xed4245
  );

  const result = await quarantineMember(client, guild, member, `${actionType} limiti`);

  if (result === 'quarantined') {
    await sendGuardLog(
      client,
      guild,
      '🔒 Saldırgan karantinelendi',
      `${member.user.tag} karantina rolü ile izole edildi.`,
      0xed4245
    );

    if (antiNuke.panic?.enabled) {
      await triggerPanicMode(client, guild, `${actionType} limiti aşıldı`, {
        raiderIds: [actorId]
      });
    }
  } else if (result === 'failed') {
    await sendGuardLog(
      client,
      guild,
      '⚠️ Karantina uygulanamadı',
      `${member.user.tag} karantinelenemedi. Karantina rolü ayarlanmamış veya bot rolün üstünde değil.\n\nDashboard > Statics bölümünden karantina rolünü ayarla.`,
      0xfaa61a
    );
  }

  return true;
}

/** Denetim günlüğünden eylemi yapan kişiyi bulur. */
export async function getExecutorId(guild, auditEvent, targetId) {
  try {
    const logs = await guild.fetchAuditLogs({ type: auditEvent, limit: 6 });
    const entry = logs.entries.find((item) => item.target?.id === targetId);
    return entry?.executor?.id || null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Quarantine Hold — karantineli üyeye dokunanı cezalandır
 * ------------------------------------------------------------------ */

/**
 * Bir rol verildiğinde karantineli bir üyeye dokunulmuşsa cezalandırır.
 */
export async function inspectRoleChange(client, guild, targetMember, addedRole, auditEvent) {
  const settings = await getSettings(client, guild.id);
  if (!settings.antiNuke?.quarantineHold) return false;
  if (!targetMember || !isQuarantined(guild.id, targetMember.id)) return false;

  const actorId = await getExecutorId(guild, auditEvent, targetMember.id);
  if (!actorId || actorId === client.user.id) return false;

  // Beyaz listedeki roller karantineli üyeye dokunabilir.
  const wl = settings.whitelist?.quarantine;
  if (wl) {
    if (wl.users?.includes(actorId)) return false;
    const actorMember = await guild.members.fetch(actorId).catch(() => null);
    if (actorMember?.roles.cache.some((role) => wl.roles?.includes(role.id))) return false;
  }

  const actor = await guild.members.fetch(actorId).catch(() => null);
  if (!actor) return false;
  if (isProtectedTarget(guild, actor, settings, client)) return false;

  await sendGuardLog(
    client,
    guild,
    '🚨 Quarantine ihlali',
    `${actor.user.tag} karantineli ${targetMember.user.tag} kullanıcısına ${addedRole ? `<@&${addedRole.id}>` : 'bir'} rol vermeye çalıştı.`,
    0xed4245
  );

  await quarantineMember(client, guild, actor, 'Quarantine ihlali');
  return true;
}

/**
 * Tehlikeli izin verilmeye çalışıldığını denetler.
 * @returns {boolean} bir şey yapıldıysa true
 */
export async function inspectDangerousPermissions(client, guild, role, permission, auditEvent) {
  const settings = await getSettings(client, guild.id);
  const antiNuke = settings.antiNuke;
  if (!antiNuke?.enabled) return false;

  const dangerous = [
    PermissionFlagsBits.Administrator,
    PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ManageWebhooks,
    PermissionFlagsBits.BanMembers,
    PermissionFlagsBits.KickMembers,
    PermissionFlagsBits.ModerateMembers
  ];

  const isDangerous = dangerous.some((flag) => permission.has(flag));

  // @everyone ve herkese açık rollere sadece strictMode'da bakılır.
  const isPublic = role.id === guild.id || settings.mainRoleIds?.includes(role.id);
  if (isPublic && !antiNuke.strictMode && !antiNuke.monitorPublicRoles) return false;

  if (!isDangerous) return false;

  const actorId = await getExecutorId(guild, auditEvent, role.id);
  if (!actorId || actorId === client.user.id) return false;

  const actor = await guild.members.fetch(actorId).catch(() => null);
  if (!actor || isProtectedTarget(guild, actor, settings, client)) return false;

  await sendGuardLog(
    client,
    guild,
    '🚨 Tehlikeli izin verildi',
    `${actor.user.tag}, ${role.name} rolüne <@&${permission.toString()}> izni verdi.\nEylem karantinelenmek üzere inceleniyor.`,
    0xed4245
  );

  await quarantineMember(client, guild, actor, 'Tehlikeli izin verme');
  return true;
}

/** Vanity URL değişikliği kontrolü. */
export async function inspectVanityChange(client, guild, auditEvent) {
  const settings = await getSettings(client, guild.id);
  if (!settings.antiNuke?.vanityProtection) return false;

  const actorId = await getExecutorId(guild, auditEvent, guild.id);
  if (!actorId || actorId === client.user.id) return false;

  const actor = await guild.members.fetch(actorId).catch(() => null);
  if (!actor || isProtectedTarget(guild, actor, settings, client)) return false;

  await sendGuardLog(client, guild, '🚨 Vanity URL değiştirildi', `${actor.user.tag} sunucu bağlantısını değiştirdi.`, 0xed4245);
  await quarantineMember(client, guild, actor, 'Vanity URL değişikliği');
  return true;
}

/* ------------------------------------------------------------------ *
 * Yardımcılar
 * ------------------------------------------------------------------ */

export function formatDuration(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} dakika`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} saat`;
  return `${Math.round(hours / 24)} gün`;
}

/* store.js'den yardımcılar (döngü bağımlılığı olmasın diye burada tanımlı) */
async function getSettings(client, guildId) {
  const { getGuildSettings } = await import('./guard-utils.js');
  return getGuildSettings(client, guildId);
}

async function saveSettings(client, guildId, settings) {
  const { saveGuildSettings } = await import('./guard-utils.js');
  return saveGuildSettings(client, guildId, settings);
}

export { AuditLogEvent };
