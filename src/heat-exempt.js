/**
 * Isı sisteminden muafiyet kontrolü.
 *
 * Wick'te beyaz liste beş ayrı tipe ayrılır ve her nesne (kullanıcı, rol,
 * kanal, kategori, webhook) her tip için ayrı ayrı muaf tutulabilir.
 * Burada da aynı model uygulanıyor: bir kullanıcı spam'dan muaf olabilir
 * ama etiket spamından muaf olmayabilir.
 */
import { PermissionFlagsBits } from 'discord.js';

const EVERYONE_PATTERN = /@(everyone|here)\b/i;

/**
 * @returns {{ invites:boolean, mentions:boolean, publicRoles:boolean, spamming:boolean }}
 */
export function isExemptFromHeat(member, message, settings, client) {
  const result = { invites: false, mentions: false, publicRoles: false, spamming: false };

  if (!member) return result;

  /* --- Tam muafiyet: sahipler ve yönetici yetkilileri --- */
  if (message.guild.ownerId === member.id) return allTrue(result);
  if (settings.ownerImmune && client.config?.ownerIds?.includes(member.id)) return allTrue(result);
  if (member.user.bot) return allTrue(result);

  /* Botlar ısı sistemiyle cezalandırılmaz (Join Gate bunu ayrı denetler). */
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return allTrue(result);
  if (member.permissions?.has(PermissionFlagsBits.ManageMessages)) return allTrue(result);

  /* --- Güvenli kullanıcı / rol listesi (her şeyden muaf) --- */
  if (settings.safeUsers?.includes(member.id)) return allTrue(result);
  if (settings.safeRoles?.some((id) => member.roles.cache.has(id))) return allTrue(result);

  /* --- Tip bazlı beyaz liste --- */
  const wl = settings.whitelist || {};

  if (matchesWhitelist(wl.invites, member, message)) result.invites = true;
  if (matchesWhitelist(wl.mentions, member, message)) result.mentions = true;
  if (matchesWhitelist(wl.publicRoles, member, message)) result.publicRoles = true;
  if (matchesWhitelist(wl.spamming, member, message)) result.spamming = true;

  /* Ana roller: herkese açık rol oldukları için ping muafiyeti. */
  if (settings.mainRoleIds?.some((id) => member.roles.cache.has(id))) {
    result.publicRoles = true;
  }

  return result;
}

/** Nesnenin verilen beyaz liste tipine uyup uymadığını kontrol eder. */
function matchesWhitelist(entry, member, message) {
  if (!entry) return false;

  if (entry.users?.includes(member.id)) return true;
  if (entry.roles?.some((id) => member.roles.cache.has(id))) return true;
  if (entry.channels?.includes(message.channelId)) return true;
  if (entry.categories?.includes(message.channel?.parentId)) return true;

  /* Webhook mesajları için webhook kimliği. */
  if (entry.webhooks?.includes(message.webhookId)) return true;

  return false;
}

/** Kullanıcının @everyone/@here pingi var mı? */
export function hasEveryonePing(content) {
  return EVERYONE_PATTERN.test(content || '');
}

function allTrue(result) {
  return { invites: true, mentions: true, publicRoles: true, spamming: true };
}
