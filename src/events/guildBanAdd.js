import { Events, AuditLogEvent } from 'discord.js';
import { getGuildSettings, sendGuardLog } from '../guard-utils.js';
import { inspectAction } from '../anti-nuke.js';

export default {
  name: Events.GuildBanAdd,
  async execute(ban, client) {
    const guild = ban.guild;
    const settings = getGuildSettings(client, guild.id);
    if (!settings.enabled) return;

    await sendGuardLog(client, guild, '🔨 Kullanıcı yasaklandı', `Kullanıcı: ${ban.user.tag}`, 0xed4245);

    /* Anti-Nuke: toplu ban limiti (nuke tespiti). */
    await inspectAction(client, guild, 'ban', ban.user.id, AuditLogEvent.MemberBanAdd).catch(() => null);
  }
};
