import { Events, AuditLogEvent } from 'discord.js';
import { getGuildSettings, sendGuardLog } from '../guard-utils.js';
import { inspectAction } from '../anti-nuke.js';

export default {
  name: Events.ChannelDelete,
  async execute(channel, client) {
    const guild = channel?.guild;
    if (!guild) return;
    const settings = getGuildSettings(client, guild.id);
    if (!settings.enabled) return;

    await sendGuardLog(client, guild, '🗑️ Kanal silindi', `Kanal: ${channel.name}`, 0xed4245);

    await inspectAction(client, guild, 'channelDelete', channel.id, AuditLogEvent.ChannelDelete);
  }
};
