import { AuditLogEvent, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import {
  createDefaultSettings as createDefaultSettingsRaw,
  withDefaults,
  writeAllSettings,
  readAllSettings,
  ensureStorage,
  listBackups,
  readBackup,
  deleteBackup,
  saveBackup,
  flushPendingWrites
} from './store.js';

const recentLogKeys = new Map();

/** Ayar şeması store.js'de yaşıyor; buradan yeniden dışa aktarılır. */
export function createDefaultSettings() {
  return createDefaultSettingsRaw();
}

/**
 * Kullanıcı adı / etiket içinde aranan kelimeler.
 *
 * ÖNEMLİ: Bu kelimeler YALNIZCA "şüpheli" listesine eklenip loglanır.
 * Tek başına ASLA otomatik ban, kick veya timeout tetiklemez.
 * Bu kelimelerden biri kullanıcı adında geçen bir kişi sunucuya
 * hâlâ tam olarak girer, tüm yetkilerini kullanır.
 */
export const USERNAME_KEYWORDS = ['fivem', 'five m', 'gta', 'gta5', 'mta', 'mtasa', 'server', 'steam'];

/**
 * Bir üyeyi iki farklı seviyede değerlendirir:
 *
 *  - `noticeReasons`  : sadece kullanıcı adı / etiket kelimeleri.
 *                       SADECE loglanır ve şüpheli listesine eklenir.
 *                       ASLA ban / kick / timeout üretmez.
 *  - `actionReasons`  : yeni hesap gibi gerçek şüphe sebepleri.
 *                       Sunucu ayarları izin verirse ceza uygulanabilir.
 *
 * Kelime eşleşmesi olan ama başka sebebi olmayan bir kullanıcı için
 * `shouldPunish` her zaman false döner.
 */
export function evaluateMember(member, settings) {
  const username = member.user.tag.toLowerCase();
  const accountAgeDays = (Date.now() - member.user.createdTimestamp) / 86400000;

  const noticeReasons = [];
  const actionReasons = [];

  const matchedKeywords = USERNAME_KEYWORDS.filter((keyword) => username.includes(keyword));
  if (matchedKeywords.length) {
    noticeReasons.push(`Şüpheli kullanıcı adı / etiket (${matchedKeywords.join(', ')}) - otomatik ceza uygulanmaz`);
  }

  if (settings.punishNewAccounts && accountAgeDays < settings.suspiciousAccountThresholdDays) {
    actionReasons.push(`Yeni hesap (${accountAgeDays.toFixed(1)} gün)`);
  }

  if (member.user.discriminator === '0000') {
    actionReasons.push('Nadiren kullanılan ayrıştırıcı');
  }

  const allReasons = [...actionReasons, ...noticeReasons];
  const shouldPunish = actionReasons.length > 0;
  const shouldList = allReasons.length > 0;

  return {
    allReasons,
    noticeReasons,
    actionReasons,
    matchedKeywords,
    shouldList,
    shouldPunish
  };
}

/** Sadece ceza üretebilecek sebepler (kelime eşleşmesi hariç). */
export function getActionableReasons(member, settings) {
  const evaluation = evaluateMember(member, settings);
  return evaluation.shouldPunish ? evaluation.actionReasons : null;
}

export async function addSuspect(client, guildId, suspect) {
  const settings = getGuildSettings(client, guildId);
  const filtered = (settings.suspects || []).filter((item) => item.userId !== suspect.userId);
  settings.suspects = [...filtered, suspect];
  await saveGuildSettings(client, guildId, settings);
  return settings;
}

export async function removeSuspect(client, guildId, userId) {
  const settings = getGuildSettings(client, guildId);
  settings.suspects = (settings.suspects || []).filter((item) => item.userId !== userId);
  await saveGuildSettings(client, guildId, settings);
  return settings;
}

export function parseSuspectActionId(customId) {
  const [action, guildId, userId] = customId.split(':');
  return { action, guildId, userId };
}

export function buildSuspiciousActionRows(guildId, suspects) {
  return suspects.slice(0, 5).map((suspect) =>
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`suspect-ban:${guildId}:${suspect.userId}`)
        .setLabel('Ban')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`suspect-kick:${guildId}:${suspect.userId}`)
        .setLabel('Kick')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`suspect-timeout:${guildId}:${suspect.userId}`)
        .setLabel('Zaman aşımı')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`suspect-test:${guildId}:${suspect.userId}`)
        .setLabel('Test')
        .setStyle(ButtonStyle.Success)
    )
  );
}

export function getSuspiciousTableUrl() {
  return 'https://docs.google.com/spreadsheets/';
}

export function isReviewAuthorized(client, interaction, settings) {
  if (isAuthorizedOwner(client, interaction.user.id)) return true;
  if (settings.reviewRoleId && interaction.member?.roles?.cache.has(settings.reviewRoleId)) return true;
  return false;
}

export function getGuildSettings(client, guildId) {
  const saved = client.guardSettings.get(guildId);
  if (!saved) return createDefaultSettings();
  if (typeof saved === 'boolean') return withDefaults({ enabled: saved });
  // withDefaults iç nesneleri de birleştirir; yeni alanlar eski kayıtlara eklenir.
  return withDefaults(saved);
}

export async function saveGuildSettings(client, guildId, settings) {
  client.guardSettings.set(guildId, settings);
  const persisted = Object.fromEntries(client.guardSettings.entries());
  await writeAllSettings(persisted);
  return settings;
}

export async function deleteGuildSettings(client, guildId) {
  client.guardSettings.delete(guildId);
  const persisted = Object.fromEntries(client.guardSettings.entries());
  await writeAllSettings(persisted);
}

export function resolveLogChannel(guild, client) {
  const settings = getGuildSettings(client, guild.id);
  const channelId = settings.logChannelId || process.env.DEFAULT_LOG_CHANNEL || '';
  return channelId ? guild.channels.cache.get(channelId) : null;
}

export async function sendGuardLog(client, guild, title, description, color = 0x5865f2, fields = [], options = {}) {
  const channel = resolveLogChannel(guild, client);
  if (!channel || !channel.isTextBased()) return;

  const dedupeWindowMs = options.dedupeWindowMs ?? 8000;
  const dedupeKey = options.dedupeKey || `${guild.id}:${title}:${description}`;
  const now = Date.now();
  const lastSent = recentLogKeys.get(dedupeKey);

  if (lastSent && now - lastSent < dedupeWindowMs) return;

  recentLogKeys.set(dedupeKey, now);
  setTimeout(() => recentLogKeys.delete(dedupeKey), dedupeWindowMs);

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();

  if (fields.length) embed.addFields(fields);

  try {
    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.warn(`⚠️ Log gönderilemedi: ${error?.message || error}`);
  }
}

export function isProtectedTarget(guild, target, settings, client) {
  if (!target) return false;
  if (guild.ownerId === target.id) return true;
  if (settings.ownerImmune && client.config?.ownerIds?.includes(target.id)) return true;
  if (settings.safeUsers.includes(target.id)) return true;

  if (target.roles?.cache) {
    const hasSafeRole = target.roles.cache.some((role) => settings.safeRoles.includes(role.id));
    if (hasSafeRole) return true;
  }

  if (target.user?.bot && settings.safeBots.includes(target.id)) return true;
  return false;
}

export function getConfiguredOwnerIds(client) {
  return [...new Set([...(client.config?.ownerIds || []), client.config?.ownerId].filter(Boolean))];
}

export function isAuthorizedOwner(client, userId) {
  if (!userId) return false;
  return getConfiguredOwnerIds(client).includes(userId);
}

/**
 * Bir üyeye otomatik ceza uygular.
 *
 * GÜVENLİK: Çağıran, cezanın gerçekten uygulanmasını istemediği sürece
 * (shouldPunish === false) burada hiçbir işlem yapılmaz. Sadece kullanıcı
 * adından bir kelime geçmesi `shouldPunish` değerini true yapmaz.
 */
export async function punishMember(member, reason, client, shouldPunish = false) {
  if (!shouldPunish) return false;

  const settings = getGuildSettings(client, member.guild.id);
  if (!settings.autoTimeoutSuspiciousUsers) return false;

  try {
    await member.timeout(10 * 60 * 1000, reason);
  } catch {
    try {
      await member.kick(reason);
    } catch {
      // ignore
    }
  }
  return true;
}

export function recordAction(client, guildId, actionType, threshold = 5, windowMs = 10000) {
  const bucketKey = `${guildId}:${actionType}`;
  const bucket = client.actionBuckets?.get(bucketKey) || [];
  const now = Date.now();
  const recent = bucket.filter((timestamp) => now - timestamp < windowMs);
  recent.push(now);
  client.actionBuckets?.set(bucketKey, recent);
  return recent.length >= threshold;
}

export async function getAuditExecutor(guild, actionType, targetId) {
  if (!guild?.fetchAuditLogs || !targetId) return null;
  try {
    const logs = await guild.fetchAuditLogs({ type: actionType, limit: 5 });
    const entry = logs.entries.find((item) => item.target?.id === targetId);
    return entry?.executor?.id || null;
  } catch {
    return null;
  }
}

export async function banUnauthorizedActor(client, guild, actorId, reason, context) {
  const settings = getGuildSettings(client, guild.id);
  if (!settings.enabled || !settings.antiNuke || !actorId) return false;

  const member = await guild.members.fetch(actorId).catch(() => null);
  if (member?.user?.bot) return false;
  if (member && isProtectedTarget(guild, member, settings, client)) return false;

  try {
    await guild.members.ban(actorId, { reason: `Şüpheli ${reason}` });
    await sendGuardLog(client, guild, '🛑 Şüpheli işlem tespit edildi', `${context} nedeniyle ${actorId} sunucudan yasaklandı.`, 0xed4245);
    return true;
  } catch {
    return false;
  }
}

/* Acil durum ve kilit modu artık ayrı modüllerde yaşıyor:
   - emergency.js  (snapshot'lar kalıcı olarak saklanır)
   - lockdown.js   (kanal izinleri doğru geri yüklenir)
   Geriye uyumluluk için buradan yeniden dışa aktarılır. */
export { enableEmergencyMode, disableEmergencyMode, hasSnapshot } from './emergency.js';
export { triggerLockdown, releaseLockdown, lockAllChannels, unlockAllChannels } from './lockdown.js';
