import { Events } from 'discord.js';
import { sendGuardLog, getGuildSettings, recordAction } from '../guard-utils.js';

export default {
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember, client) {
    const guild = newMember.guild;
    const settings = getGuildSettings(client, guild.id);
    if (!settings.enabled) return;

    const before = oldMember.roles.cache.size;
    const after = newMember.roles.cache.size;
    if (before !== after) {
      const suspicious = recordAction(client, guild.id, 'role-add', settings.actionThreshold, settings.actionWindowMs);
      if (suspicious) {
        await sendGuardLog(client, guild, '⚠️ Şüpheli rol spamı tespit edildi', `Kullanıcı: ${newMember.user.tag}`, 0xed4245);
      }
    }
  }
};
