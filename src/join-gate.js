/**
 * Join Gate — sunucuya katılan her üyeyi bağımsız filtrelerden geçirir.
 *
 * Wick'teki JoinGate'in her filtresi kendi cezasını taşır (log / timeout /
 * kick / ban). Aynı yaklaşım: filtreler birbirinden bağımsızdır, birden
 * fazla filtre aynı kullanıcıyı yakalayabilir.
 *
 * ÖNEMLİ: kullanıcı adı filtresi varsayılan olarak SADECE loglar.
 * Kelime eşleşmesi tek başına asla ceza üretmez.
 */
import { evaluateMember } from './guard-utils.js';

const INVITE_IN_NAME = /(discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\//i;

/** Filtre adları → etiketler (dashboard ve loglar için). */
export const JOIN_GATE_FILTERS = {
  noAvatar: 'Avatarı olmayan hesaplar',
  newAccount: 'Yeni hesaplar',
  botAddition: 'Yetkisiz bot ekleme',
  unverifiedBot: 'Discord tarafından doğrulanmamış botlar',
  advertisingName: 'Kullanıcı adında davet linki',
  suspiciousAccount: 'Şüpheli hesaplar',
  username: 'Kullanıcı adı filtresi'
};

/**
 * Bir üyeyi tüm filtrelerden geçirir ve eylemleri uygular.
 * @returns {Array<{filter:string, action:string, reason:string}>} uygulanan işlemler
 */
export async function runJoinGate(client, guild, member, settings) {
  const gate = settings.joinGate;
  if (!gate?.enabled) return [];
  if (!settings.enabled) return [];

  const applied = [];
  const log = [];

  /* Bot ekleme filtresi en kritik olanı — her zaman en başta. */
  if (member.user.bot) {
    if (gate.botAddition?.enabled && !isAuthorizedBotAdder(guild, member, settings, client)) {
      await applyAction(member, gate.botAddition.action, 'Yetkisiz bot eklendi', applied, 'botAddition');
      log.push(`Bot: ${member.user.tag} yetkisiz eklendi → ${gate.botAddition.action}`);
      return applied;
    }

    if (gate.unverifiedBot?.enabled && !member.user.verified) {
      await applyAction(member, gate.unverifiedBot.action, 'Doğrulanmamış bot', applied, 'unverifiedBot');
      log.push(`Doğrulanmamış bot: ${member.user.tag} → ${gate.unverifiedBot.action}`);
      return applied;
    }
    return applied;
  }

  /* Avatar filtresi */
  if (gate.noAvatar?.enabled && !hasAvatar(member.user)) {
    await applyAction(member, gate.noAvatar.action, 'Avatarı yok', applied, 'noAvatar');
    log.push(`Avatar yok: ${member.user.tag} → ${gate.noAvatar.action}`);
  }

  /* Hesap yaşı filtresi */
  if (gate.newAccount?.enabled) {
    const ageDays = (Date.now() - member.user.createdTimestamp) / 86400000;
    const minAge = gate.newAccount.minAgeDays ?? 7;
    if (ageDays < minAge) {
      await applyAction(member, gate.newAccount.action, `Hesap ${ageDays.toFixed(1)} günlük (min ${minAge})`, applied, 'newAccount');
      log.push(`Yeni hesap: ${member.user.tag} (${ageDays.toFixed(1)} gün) → ${gate.newAccount.action}`);
    }
  }

  /* Kullanıcı adında davet linki */
  if (gate.advertisingName?.enabled && INVITE_IN_NAME.test(member.user.tag)) {
    await applyAction(member, gate.advertisingName.action, 'Kullanıcı adında davet linki', applied, 'advertisingName');
    log.push(`Adında link: ${member.user.tag} → ${gate.advertisingName.action}`);
  }

  /* Şüpheli hesap — evaluateMember'ın ceza üretebilen sebeplerine bakar.
     Kelime eşleşmesi burada sayılmaz. */
  if (gate.suspiciousAccount?.enabled) {
    const evaluation = evaluateMember(member, { ...settings, punishNewAccounts: true });
    if (evaluation.shouldPunish) {
      await applyAction(member, gate.suspiciousAccount.action, evaluation.actionReasons.join(', '), applied, 'suspiciousAccount');
      log.push(`Şüpheli: ${member.user.tag} (${evaluation.actionReasons.join(', ')}) → ${gate.suspiciousAccount.action}`);
    }
  }

  /* Kullanıcı adı filtresi — varsayılan SADECE loglar */
  if (gate.username?.enabled) {
    const evaluation = evaluateMember(member, settings);
    if (evaluation.matchedKeywords.length) {
      const keywords = evaluation.matchedKeywords.join(', ');
      const action = gate.username.punishOnMatch ? gate.username.action : 'log';
      await applyAction(member, action, `Kullanıcı adında: ${keywords}`, applied, 'username');
      log.push(`İsim filtresi: ${member.user.tag} (${keywords}) → ${action}`);
    }
  }

  if (applied.length || log.length) {
    await reportJoinGate(client, guild, member, applied, log, settings);
  }
  return applied;
}

/* ------------------------------------------------------------------ *
 * Yardımcılar
 * ------------------------------------------------------------------ */

function hasAvatar(user) {
  return !user.displayAvatarURL().includes('embed/avatars/n.png');
}

/**
 * Bot eklemeye yetkili mi?
 * Sunucu sahibi, bot sahipleri, güvenilir roller ve botun kendisinden
 * üstteki roller yetkilidir.
 */
function isAuthorizedBotAdder(guild, member, settings, client) {
  const isOwner = guild.ownerId === member.id;
  const isBotOwner = client.config?.ownerIds?.includes(member.id);

  const trustedIds = [
    ...(settings.safeUsers || []),
    ...(settings.safeRoles || []),
    ...(settings.mainRoleIds || []),
    ...(settings.whitelist?.permitRoles || [])
  ];

  const isTrusted = trustedIds.includes(member.id) ||
    member.roles.cache.some((role) => trustedIds.includes(role.id));

  // Entegrasyon ekleyenler rol üstünde kontrole sahip olur.
  const me = guild.members.me;
  const isAboveBot = me && member.roles.highest.comparePositionTo(me.roles.highest) > 0;

  return isOwner || isBotOwner || isTrusted || isAboveBot;
}

/**
 * Filtre cezasını uygular.
 * `log` ve `delete` dışındaki eylemler gerçek moderasyon işlemidir.
 */
async function applyAction(member, action, reason, applied, filter) {
  const actionName = action || 'log';
  applied.push({ filter, action: actionName, reason });

  if (actionName === 'log') return;

  try {
    if (actionName === 'timeout') {
      await member.timeout(600000, `JoinGate/${filter}: ${reason}`);
    } else if (actionName === 'kick') {
      await member.kick(`JoinGate/${filter}: ${reason}`);
    } else if (actionName === 'ban') {
      await member.ban({ reason: `JoinGate/${filter}: ${reason}` });
    } else if (actionName === 'quarantine') {
      // Karantina bot istemcisine ihtiyaç duyar; çağıran taraf yönetir.
      const { quarantineMember } = await import('./anti-nuke.js');
      await quarantineMember(member.guild.client, member.guild, member, `JoinGate/${filter}: ${reason}`);
    }
  } catch {
    // Bot yetkisi yoksa sessiz geç, log zaten atıldı.
  }
}

async function reportJoinGate(client, guild, member, applied, log, settings) {
  const { sendGuardLog } = await import('./guard-utils.js');

  const fields = log.map((line, index) => ({ name: `Filtre ${index + 1}`, value: line, inline: false }));
  if (!fields.length) return;

  const punished = applied.some((item) => item.action !== 'log');

  await sendGuardLog(
    client,
    guild,
    punished ? '🚫 Join Gate — üye işlendi' : 'ℹ️ Join Gate — kayda alındı',
    `Kullanıcı: ${member.user.tag}\nHesap yaşı: ${((Date.now() - member.user.createdTimestamp) / 86400000).toFixed(1)} gün`,
    punished ? 0xed4245 : 0xfaa61a,
    fields
  );

  // Şüpheli rolü ver (yalnızca gerçek ceza üreten filtreler varsa).
  if (punished && settings.suspectRoleId) {
    const role = guild.roles.cache.get(settings.suspectRoleId);
    if (role) await member.roles.add(role, 'Join Gate').catch(() => null);
  }
}
