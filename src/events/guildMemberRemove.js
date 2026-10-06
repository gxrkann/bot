import { Events, AuditLogEvent } from 'discord.js';
import { getGuildSettings, sendGuardLog } from '../guard-utils.js';
import { inspectAction } from '../anti-nuke.js';

export default {
  name: Events.GuildMemberRemove,
  async execute(member, client) {
    const guild = member?.guild;
    if (!guild) return;
    const settings = getGuildSettings(client, guild.id);
    if (!settings.enabled) return;

    if (member.user?.bot) return;

    await sendGuardLog(client, guild, '🚪 Üye ayrıldı', `Kullanıcı: ${member.user.tag}`, 0xfaa61a);

    /* Anti-Nuke: toplu kick limiti (raid tespiti). */
    await inspectAction(client, guild, 'kick', member.id, AuditLogEvent.MemberKick).catch(() => null);
  }
};
