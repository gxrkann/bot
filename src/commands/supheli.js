import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getGuildSettings, getSuspiciousTableUrl, buildSuspiciousActionRows, isReviewAuthorized, removeSuspect } from '../guard-utils.js';

export default {
  data: new SlashCommandBuilder()
    .setName('supheli')
    .setDescription('Sunucudaki şüpheli kullanıcıları göster')
    .addBooleanOption((opt) => opt.setName('temizle').setDescription('Şüpheli rolü olmayanları tablodan sil').setRequired(false)),

  async execute(interaction, client) {
    if (!interaction.guild || !interaction.member) return;

    const settings = getGuildSettings(client, interaction.guildId);
    if (!isReviewAuthorized(client, interaction, settings)) {
      await interaction.reply({ content: 'Bu komutu kullanmak için yetkiniz yok.', flags: MessageFlags.Ephemeral });
      return;
    }

    const doClean = interaction.options.getBoolean('temizle');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    let suspects = settings.suspects || [];

    if (doClean) {
      if (!settings.suspectRoleId) {
        await interaction.editReply({ content: 'Sunucuda `suspectRoleId` ayarlı değil. `/guard ayar` ile `guvenilirrolu` veya suspect rolünü ayarlayın.' });
        return;
      }

      const removed = [];
      for (const s of [...suspects]) {
        try {
          const member = await interaction.guild.members.fetch(s.userId).catch(() => null);
          if (!member || !member.roles.cache.has(settings.suspectRoleId)) {
            await removeSuspect(client, interaction.guildId, s.userId).catch(() => null);
            removed.push(s.userId);
          }
        } catch {
          // ignore per-item errors
        }
      }
      suspects = settings.suspects || [];
      await interaction.editReply({ content: `Temizleme tamamlandı. Silinenler: ${removed.length ? removed.join(', ') : 'Yok'}` });
      return;
    }
    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('Şüpheli Kullanıcılar')
      .setDescription(suspects.length
        ? suspects.slice(0, 5).map((item, index) => `**${index + 1}.** <@${item.userId}> — ${item.userTag}\nNeden: ${item.reasons.join(', ')}`).join('\n\n')
        : 'Şu anda kayıtlı şüpheli kullanıcı bulunmuyor.')
      .addFields(
        { name: 'Google Tablo', value: `[Şüpheli Kişiler Tablosu](${getSuspiciousTableUrl()})` },
        { name: 'Not', value: 'Listede ilk 5 şüpheli gösteriliyor. Ban / Kick / Zaman aşımı / Test butonlarını kullanabilirsiniz.' }
      );

    const rows = buildSuspiciousActionRows(interaction.guildId, suspects);
    await interaction.editReply({ embeds: [embed], components: rows.length ? rows : [] });
  }
};
