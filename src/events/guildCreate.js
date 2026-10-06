import { Events } from 'discord.js';
import { getGuildSettings, createDefaultSettings, saveGuildSettings, sendGuardLog } from '../guard-utils.js';
import { setupVerificationChannel } from '../verification.js';
import { startBackupScheduler } from '../backup.js';

export default {
  name: Events.GuildCreate,
  async execute(guild, client) {
    /* index.js de aynı olayı dinliyor; burada tekrar kaydetmeyelim. */
    if (client.guardSettings.has(guild.id)) return;

    await saveGuildSettings(client, guild.id, createDefaultSettings());
    console.log(`➕ Sunucuya katıldı: ${guild.name} (${guild.id})`);

    /* Bot gerekli izinlere sahip mi? Kurulumu erken fark et. */
    const me = guild.members.me;
    if (me) {
      const problems = [];
      if (!me.permissions.has('Administrator') && !me.permissions.has('ManageServer')) {
        problems.push('Yönetici veya Sunucuyu Yönet yetkisi yok');
      }
      if (!me.permissions.has('ModerateMembers')) problems.push('Üyeleri Yönet (Moderate Members) yetkisi yok');
      if (!me.permissions.has('MoveMembers')) problems.push('Üyeleri Taşı (Move Members) yetkisi yok — karantina çalışmaz');
      if (problems.length) {
        await sendGuardLog(
          client, guild,
          '⚠️ Bot yetkileri yetersiz',
          `${problems.join('\n')}\n\nDashboard > Genel Bakış sayfasından kurulumu kontrol et.`,
          0xfaa61a
        );
      }
    }

    /* Doğrulama kanalını kur (etkinse). */
    const settings = getGuildSettings(client, guild.id);
    if (settings.verification?.enabled) {
      await setupVerificationChannel(client, guild, settings).catch(() => null);
    }

    startBackupScheduler(client, guild);
  }
};
