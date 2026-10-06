import { Events, AuditLogEvent } from 'discord.js';
import { getGuildSettings, sendGuardLog } from '../guard-utils.js';
import { inspectDangerousPermissions } from '../anti-nuke.js';

/**
 * Kanal izinleri denetimi.
 *
 * Wick, "Monitor Channel Permissions" ayarıyla kanal izinlerinin izlenmesini
 * sunar: biri @everyone'a veya ana rollere tehlikeli izin vermeye çalışırsa
 * tespit edilir.
 */
export default {
  name: Events.ChannelUpdate,
  async execute(oldChannel, newChannel, client) {
    const guild = newChannel?.guild;
    if (!guild) return;
    const settings = getGuildSettings(client, guild.id);
    if (!settings.enabled) return;

    if (oldChannel.name !== newChannel.name) {
      await sendGuardLog(client, guild, '✏️ Kanal yeniden adlandırıldı', `Kanal: ${newChannel.name}`, 0xfaa61a);
    }

    if (serializeOverwrites(oldChannel) === serializeOverwrites(newChannel)) return;

    await sendGuardLog(client, guild, '🔐 Kanal izinleri değişti', `Kanal: ${newChannel.name}`, 0xfaa61a);

    if (!settings.antiNuke?.monitorChannelPermissions) return;

    /* @everyone ve ana roller için tehlikeli izin verilip verilmedi? */
    const targets = [guild.id, ...(settings.mainRoleIds || [])];

    for (const targetId of targets) {
      const before = oldChannel.permissionOverwrites.cache.get(targetId);
      const after = newChannel.permissionOverwrites.cache.get(targetId);

      const unchanged = before?.deny.bitfield === after?.deny.bitfield &&
        before?.allow.bitfield === after?.allow.bitfield;
      if (unchanged) continue;

      // inspectDangerousPermissions bir rol nesnesi bekliyor; kanal hedefi için
      // yalnızca kimlik ve izinler gerekiyor.
      const target = {
        id: targetId,
        name: targetId === guild.id ? '@everyone' : (guild.roles.cache.get(targetId)?.name || 'Ana rol')
      };

      await inspectDangerousPermissions(
        client,
        guild,
        target,
        after?.allow || 0n,
        AuditLogEvent.ChannelOverwriteUpdate
      ).catch(() => null);
    }
  }
};

function serializeOverwrites(channel) {
  return JSON.stringify(
    [...channel.permissionOverwrites.cache.values()]
      .map((ow) => [ow.id, ow.allow.bitfield.toString(), ow.deny.bitfield.toString()])
      .sort((a, b) => a[0].localeCompare(b[0]))
  );
}
