import { Events, AuditLogEvent } from 'discord.js';
import { getGuildSettings, sendGuardLog } from '../guard-utils.js';
import { inspectAction } from '../anti-nuke.js';

export default {
  name: Events.GuildRoleDelete,
  async execute(role, client) {
    const guild = role?.guild;
    if (!guild) return;
    const settings = getGuildSettings(client, guild.id);
    if (!settings.enabled) return;

    await sendGuardLog(client, guild, '🗑️ Rol silindi', `Rol: ${role.name}`, 0xed4245);

    await inspectAction(client, guild, 'roleDelete', role.id, AuditLogEvent.RoleDelete);
  }
};
