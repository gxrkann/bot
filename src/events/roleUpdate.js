import { Events, AuditLogEvent } from 'discord.js';
import { getGuildSettings, sendGuardLog } from '../guard-utils.js';
import { inspectDangerousPermissions } from '../anti-nuke.js';

export default {
  name: Events.GuildRoleUpdate,
  async execute(oldRole, newRole, client) {
    const guild = newRole?.guild;
    if (!guild) return;
    const settings = getGuildSettings(client, guild.id);
    if (!settings.enabled) return;

    const permissionChanged = oldRole.permissions.bitfield !== newRole.permissions.bitfield;

    if (permissionChanged) {
      await sendGuardLog(
        client,
        guild,
        '🔑 Rol izinleri değişti',
        `Rol: ${newRole.name}\nEski: ${oldRole.permissions.bitfield.toString()}\nYeni: ${newRole.permissions.bitfield.toString()}`,
        0xfaa61a
      );
    }

    if (oldRole.name !== newRole.name) {
      await sendGuardLog(client, guild, '🏷️ Rol yeniden adlandırıldı', `Eski: ${oldRole.name}\nYeni: ${newRole.name}`, 0xfaa61a);
    }

    /* Tehlikeli izin verilmesini denetle. */
    if (permissionChanged && newRole.permissions.bitfield > oldRole.permissions.bitfield) {
      await inspectDangerousPermissions(
        client, guild, newRole, newRole.permissions, AuditLogEvent.RoleUpdate
      ).catch(() => null);
    }
  }
};
