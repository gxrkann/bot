import { Events, AuditLogEvent } from 'discord.js';
import { getGuildSettings, sendGuardLog } from '../guard-utils.js';
import { inspectAction } from '../anti-nuke.js';

export default {
  name: Events.ChannelCreate,
  async execute(channel, client) {
    const guild = channel?.guild;
    if (!guild) return;
    const settings = getGuildSettings(client, guild.id);
    if (!settings.enabled) return;

    await sendGuardLog(client, guild, '📁 Kanal oluşturuldu', `Kanal: ${channel.name}`, 0x5865f2);

    /* Anti-Nuke limit kontrolü — aşılırsa saldırgan karantinelenir. */
    await inspectAction(client, guild, 'channelCreate', channel.id, AuditLogEvent.ChannelCreate);
  }
};
