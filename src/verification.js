/**
 * Verification — yeni gelen üyelerin doğrulanması.
 *
 * Wick'te doğrulama bir kanala tek bir mesaj + buton bırakır. Üye butona
 * basınca rol alır. Modlar: buton (en güvenli), basit kod, web.
 *
 * Burada iki mod var:
 *   - button: tek tıkla doğrulanır (Discord'un en güvenilir yöntemi)
 *   - code:   kullanıcı kodu kanalda paylaşır (captcha benzeri)
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { sendGuardLog } from './guard-utils.js';

/** guildId -> Map<userId, { code:string, createdAt:number, verified:boolean }> */
const pending = new Map();
/** guildId -> Map<userId, code> */
const codes = new Map();

const CODE_TTL_MS = 10 * 60 * 1000;

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

/* ------------------------------------------------------------------ *
 * Kanal kurulumu
 * ------------------------------------------------------------------ */

/**
 * Doğrulama kanalını hazırlar: eski mesajları siler, buton mesajını gönderir.
 */
export async function setupVerificationChannel(client, guild, settings) {
  const config = settings.verification;
  const channelId = config.channelId || settings.mainChannelId;
  if (!channelId) return { ok: false, reason: 'Kanal ayarlanmamış' };

  const channel = guild.channels.cache.get(channelId);
  if (!channel) return { ok: false, reason: 'Kanal bulunamadı' };
  if (!channel.isTextBased()) return { ok: false, reason: 'Kanal metin kanalı değil' };
  if (!channel.manageable) return { ok: false, reason: 'Botun kanal yönetme yetkisi yok' };

  // Önceki doğrulama mesajlarını temizle (14 günden eski olanlar silinemez, sorun değil).
  await channel.bulkDelete(50, true).catch(() => null);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`verify:${guild.id}`)
      .setLabel('✅ Doğrula')
      .setStyle(ButtonStyle.Success)
  );

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Doğrulama')
    .setDescription(
      config.mode === 'button'
        ? 'Sunucuya hoş geldin! Başlamak için aşağıdaki **Doğrula** butonuna bas.'
        : 'Sunucuya hoş geldin! Lütfen bir sonraki mesajda kanalda yazan kodu gir.'
    )
    .addFields(
      { name: 'Hedef', value: config.target === 'all' ? 'Tüm yeni üyeler' : 'Şüpheli hesaplar', inline: true },
      { name: 'Başarısızlıkta', value: config.action, inline: true }
    );

  if (config.note) embed.setFooter({ text: config.note });

  await channel.send({ embeds: [embed], components: [row] });
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Doğrulama akışı
 * ------------------------------------------------------------------ */

/**
 * Katılan üyenin doğrulamaya gerekçesi var mı?
 * @returns {boolean}
 */
export function needsVerification(member, settings) {
  const config = settings.verification;
  if (!config?.enabled) return false;
  if (member.user.bot) return false;

  // Zaten doğrulanmış mı?
  if (settings.mainRoleIds?.length) {
    const hasMain = member.roles.cache.some((role) => settings.mainRoleIds.includes(role.id));
    if (hasMain) return false;
  }

  if (config.target === 'all') return true;

  // target === 'suspicious'
  const ageDays = (Date.now() - member.user.createdTimestamp) / 86400000;
  const noAvatar = member.user.displayAvatarURL().includes('embed/avatars/n.png');
  const suspiciousAge = ageDays < (settings.joinGate?.newAccount?.minAgeDays ?? 7);
  return suspiciousAge || noAvatar;
}

/**
 * Üyeye doğrulama kodunu ata ve kanalda göster.
 */
export async function startVerification(client, guild, member, settings) {
  const config = settings.verification;
  if (!needsVerification(member, settings)) return null;

  const code = config.mode === 'code' ? generateCode() : null;

  if (!pending.has(guild.id)) pending.set(guild.id, new Map());
  pending.get(guild.id).set(member.id, {
    code,
    createdAt: Date.now(),
    verified: false
  });

  if (code) {
    if (!codes.has(guild.id)) codes.set(guild.id, new Map());
    codes.get(guild.id).set(code, member.id);

    const channelId = config.channelId || settings.mainChannelId;
    const channel = channelId ? guild.channels.cache.get(channelId) : null;
    if (channel) {
      await channel.send({
        content: `<@${member.id}>, doğrulama kodun: \`${code}\``,
        allowedMentions: { users: [member.id] }
      }).catch(() => null);
    }
  }

  await sendGuardLog(
    client,
    guild,
    '🔐 Doğrulama bekleniyor',
    `${member.user.tag} doğrulamaya alındı.\nMod: ${config.mode} | Başarısızlıkta: ${config.action}`,
    0xfaa61a
  );

  return { code };
}

/**
 * Butona basıldığında veya kod doğrulandığında çağrılır.
 * @returns {{ ok:boolean, reason?:string }}
 */
export async function completeVerification(client, guild, member, settings, inputCode) {
  const config = settings.verification;
  const entry = pending.get(guild.id)?.get(member.id);

  if (!entry) return { ok: false, reason: 'Bekleyen doğrulaman yok.' };

  // Süre kontrolü.
  if (Date.now() - entry.createdAt > CODE_TTL_MS) {
    pending.get(guild.id)?.delete(member.id);
    return { ok: false, reason: 'Doğrulama süresi doldu. Yeniden denemek için sunucuya bak.' };
  }

  if (config.mode === 'code') {
    if (!inputCode || String(inputCode).toUpperCase() !== entry.code) {
      return { ok: false, reason: 'Kod hatalı.' };
    }
  }

  // Ana rolü ver.
  const mainRoles = settings.mainRoleIds || [];
  if (mainRoles.length) {
    const roles = mainRoles.map((id) => guild.roles.cache.get(id)).filter(Boolean);
    if (roles.length) await member.roles.add(roles, 'Doğrulama başarılı').catch(() => null);
  }

  // Karantina rolü varsa kaldır.
  if (settings.quarantineRoleId) {
    const qRole = guild.roles.cache.get(settings.quarantineRoleId);
    if (qRole) await member.roles.remove(qRole, 'Doğrulama başarılı').catch(() => null);
  }

  entry.verified = true;
  if (entry.code && codes.get(guild.id)) codes.get(guild.id).delete(entry.code);

  await sendGuardLog(client, guild, '✅ Doğrulama başarılı', `${member.user.tag} doğrulandı.`, 0x57f287);
  return { ok: true };
}

/**
 * Doğrulama zaman aşımına uğrayanlara ceza uygular.
 * Zamanlayıcı index.js içinde kurulur.
 */
export async function applyVerificationFailure(client, guild, member, settings, reason) {
  const action = settings.verification.action;
  try {
    if (action === 'kick') {
      await member.kick(`Verification: ${reason}`);
    } else if (action === 'ban') {
      await member.ban({ reason: `Verification: ${reason}` });
    } else if (action === 'quarantine') {
      const { quarantineMember } = await import('./anti-nuke.js');
      await quarantineMember(client, guild, member, `Verification: ${reason}`);
    }
  } catch {
    // yetki yoksa yoksay
  }
}

/**
 * Bot yeniden başladığında bekleyen doğrulamaları temizler.
 * (RAM'de tutulduğu için eski kodlar zaten kaybolur, bu sadece log içindir.)
 */
export function clearPending(guildId) {
  pending.delete(guildId);
  codes.delete(guildId);
}

export function getPendingCount(guildId) {
  return pending.get(guildId)?.size ?? 0;
}

export { CODE_TTL_MS };
