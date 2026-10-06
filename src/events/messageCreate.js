import { Events, AuditLogEvent, PermissionFlagsBits } from 'discord.js';
import { getGuildSettings, sendGuardLog, evaluateMember } from '../guard-utils.js';
import { analyzeMessage } from '../heat.js';
import { isExemptFromHeat } from '../heat-exempt.js';

export default {
  name: Events.MessageCreate,
  async execute(message, client) {
    if (!message?.guild || message.author.bot) return;

    const guild = message.guild;
    const settings = getGuildSettings(client, guild.id);
    if (!settings.enabled) return;

    /* --- Beyaz liste kontrolleri --- */
    const exempt = isExemptFromHeat(message.member, message, settings, client);
    if (exempt.invites) return;      // davet paylaşımından muaf
    if (exempt.mentions) return;     // etiket spamından muaf
    if (exempt.publicRoles) return;  // @everyone pinginden muaf

    /* --- Isı sistemi --- */
    if (settings.heat?.enabled) {
      const result = await analyzeMessage(message, client, settings.heat);

      if (result.action === 'timeout') {
        const top = result.contributions
          .slice()
          .sort((a, b) => b.heat - a.heat)
          .slice(0, 4)
          .map((c) => `${filterLabel(c.key)}: +${Math.round(c.heat)}`)
          .join('\n');

        await sendGuardLog(
          client,
          guild,
          '🌡️ Otomatik timeout (ısı limiti)',
          `Kullanıcı: ${message.author.tag}\nSon ısı: ${result.heat}/${settings.heat.maxHeat}\n\n${top}`,
          0xed4245
        );
      }
      return;
    }

    /* --- Isı sistemi kapalıysa basit eski kontroller --- */
    await legacyChecks(message, client, settings);
  }
};

/* ------------------------------------------------------------------ *
 * Isı sistemi kapalıyken basit kontroller
 * ------------------------------------------------------------------ */

const invitePattern = /(discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\//i;
const repeatedCharsPattern = /(.)\1{4,}/;

async function legacyChecks(message, client, settings) {
  const guild = message.guild;
  const content = message.content || '';

  /* Davet linki */
  if (settings.antiInvite && invitePattern.test(content)) {
    await deleteAndLog(message, client, 'Davet linki tespit edildi');
    return;
  }

  /* Tekrarlayan karakter */
  if (settings.antiSpam && repeatedCharsPattern.test(content)) {
    await deleteAndLog(message, client, 'Tekrarlayan karakter spamı');
  }
}

async function deleteAndLog(message, client, reason) {
  if (message.deletable) await message.delete().catch(() => null);
  await sendGuardLog(
    client,
    message.guild,
    '⚠️ Şüpheli mesaj kaldırıldı',
    `${message.author.tag}: ${reason}`,
    0xed4245
  );
}

function filterLabel(key) {
  return {
    message: 'Normal mesaj', repetition: 'Tekrar', emoji: 'Emoji', characters: 'Karakter',
    newLine: 'Satır', mentions: 'Etiket', attachments: 'Ek', advertisement: 'Reklam',
    nsfw: 'NSFW', malicious: 'Zararlı bağlantı', words: 'Kara liste kelime',
    inactiveChannel: 'Düşük aktivite'
  }[key] || key;
}

export { AuditLogEvent, PermissionFlagsBits };
