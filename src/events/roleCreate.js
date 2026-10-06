import { Events, AuditLogEvent } from 'discord.js';
import { getGuildSettings, sendGuardLog } from '../guard-utils.js';
import { inspectAction } from '../anti-nuke.js';

export default {
  name: Events.RoleCreate,
  async execute(role, client) {
    const guild = role?.guild;
    if (!guild) return;
    const settings = getGuildSettings(client, guild.id);
    if (!settings.enabled) return;

    await sendGuardLog(client, guild, '🎭 Rol oluşturuldu', `Rol: ${role.name}`, 0x57f287);

    await inspectAction(client, guild, 'roleCreate', role.id, AuditLogEvent.RoleCreate);
  }
};
