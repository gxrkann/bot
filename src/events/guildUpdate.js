import { Events } from 'discord.js';
import { getGuildSettings, sendGuardLog } from '../guard-utils.js';
import { inspectVanityChange } from '../anti-nuke.js';

export default {
  name: Events.GuildUpdate,
  async execute(oldGuild, newGuild, client) {
    const settings = getGuildSettings(client, newGuild?.id || '');
    if (!settings.enabled) return;

    if (oldGuild.name !== newGuild.name) {
      await sendGuardLog(
        client, newGuild,
        '📛 Sunucu adı değişti',
        `Eski: ${oldGuild.name}\nYeni: ${newGuild.name}`,
        0xfaa61a
      );
    }

    if (oldGuild.iconURL() !== newGuild.iconURL()) {
      await sendGuardLog(client, newGuild, '🖼️ Sunucu simgesi değişti', 'Simge güncellendi.', 0xfaa61a);
    }

    if (oldGuild.bannerURL() !== newGuild.bannerURL()) {
      await sendGuardLog(client, newGuild, '🎏 Sunucu bannerı değişti', 'Banner güncellendi.', 0xfaa61a);
    }

    /* Vanity URL koruması: sunucu bağlantısı değiştiyse saldırgan olabilir. */
    if (oldGuild.vanityURLCode !== newGuild.vanityURLCode) {
      await inspectVanityChange(client, newGuild, undefined).catch(() => null);
    }
  }
};
