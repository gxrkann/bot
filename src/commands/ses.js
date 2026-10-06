import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getGuildSettings, saveGuildSettings } from '../guard-utils.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ses')
    .setDescription('Botu ses kanalına sokar veya çıkarır.')
    .addSubcommand(sub => sub
      .setName('katil')
      .setDescription('Botu senin bulunduğun ses kanalına katar (kalıcı).')
      .addBooleanOption(opt => opt.setName('sustur').setDescription('Bot sessiz alsın mı? (varsayılan: evet)'))
      .addBooleanOption(opt => opt.setName('sagirlastir').setDescription('Bot sağırlaşsın mı? (varsayılan: evet)')))
    .addSubcommand(sub => sub
      .setName('birak')
      .setDescription('Botu ses kanalından çıkarır ve kaydı siler.'))
    .addSubcommand(sub => sub
      .setName('bilgi')
      .setDescription('Botun mevcut ses bağlantı durumunu göster.'))
    .addSubcommand(sub => sub
      .setName('yenidenbaglan')
      .setDescription('Kayıtlı ses kanalına yeniden bağlanır.')),
  async execute(interaction, client) {
    if (!interaction.guild || !interaction.member) return;

    const isGuildOwner = interaction.guild.ownerId === interaction.user.id;
    const hasAdmin = interaction.member.permissions?.has(PermissionFlagsBits.Administrator) || interaction.member.permissions?.has(PermissionFlagsBits.ManageGuild);
    const ownerIds = new Set([client.config?.ownerId, process.env.OWNER_ID, process.env.OWNER_ID_2]
      .filter(Boolean)
      .flatMap((v) => String(v).split(',').map((s) => s.trim()).filter(Boolean)));

    if (!ownerIds.has(interaction.user.id) && !isGuildOwner && !hasAdmin) {
      await interaction.reply({ content: '⚠️ Bu komut sadece bot sahipleri, sunucu sahibi veya yönetici yetkisi olan kişiler içindir.', flags: 64 });
      return;
    }

    try {
      await interaction.deferReply({ flags: 64 });
    } catch (error) {
      /* Bazen interaction daha önce acknowledge edilmiş olabiliyor (çift process,
         hızlı iki komut). deferReply başarısızsa işlem yapılmaz. */
      if (error.code === 'InteractionAlreadyReplied' || error.code === 40060) return;
      throw error;
    }
    const sub = interaction.options.getSubcommand();
    const settings = getGuildSettings(client, interaction.guildId);

    let voice;
    try {
      voice = await import('../voice.js');
    } catch (error) {
      await interaction.editReply({ content: '❌ `@discordjs/voice` paketi yüklü değil. Terminalde çalıştır: `npm install @discordjs/voice`' });
      return;
    }

    if (sub === 'katil') {
      const channel = interaction.member.voice?.channel;
      if (!channel) {
        await interaction.editReply({ content: '⚠️ Önce bir ses kanalına katıl, sonra bu komutu kullan.' });
        return;
      }
      if (!channel.isVoiceBased() || channel.isDMBased?.()) {
        await interaction.editReply({ content: '❌ Bu bir ses kanalı değil.' });
        return;
      }

      settings.voice.enabled = true;
      settings.voice.channelId = channel.id;
      settings.voice.selfMute = interaction.options.getBoolean('sustur') ?? true;
      settings.voice.selfDeaf = interaction.options.getBoolean('sagirlastir') ?? true;
      await saveGuildSettings(client, interaction.guildId, settings);

      const result = await voice.joinVoiceChannel(client, interaction.guild, channel.id, {
        selfMute: settings.voice.selfMute,
        selfDeaf: settings.voice.selfDeaf
      });

      if (result.ok) {
        await interaction.editReply({ content: `✅ Bot #${channel.name} kanalına katıldı. Kalıcı olarak bu kanalda bekleyecek.` });
      } else {
        await interaction.editReply({ content: `⚠️ Ayar kaydedildi ama bağlantı kurulamadı: ${result.error || 'bilinmiyor'}\n\nKomutu yeniden dene veya log kanalında sebebini kontrol et.` });
      }
      return;
    }

    if (sub === 'birak') {
      settings.voice.enabled = false;
      settings.voice.channelId = '';
      await saveGuildSettings(client, interaction.guildId, settings);

      await voice.leaveVoiceChannel(interaction.guild, 'kullanıcı isteği');
      await interaction.editReply({ content: '👋 Bot ses kanalından çıkarıldı ve ses ayarı kapatıldı.' });
      return;
    }

    if (sub === 'bilgi') {
      const state = voice.getVoiceState(interaction.guildId);
      if (!state) {
        await interaction.editReply({ content: '🔌 Bot şu an hiçbir ses kanalında değil.' });
        return;
      }
      const channel = interaction.guild.channels.cache.get(state.channelId);
      await interaction.editReply({ content: `🔊 Bot **#${channel?.name || state.channelId}** kanalında. Sessiz: ${state.selfMute ? 'evet' : 'hayır'}, Sağır: ${state.selfDeaf ? 'evet' : 'hayır'}` });
      return;
    }

    if (sub === 'yenidenbaglan') {
      if (!settings.voice?.enabled || !settings.voice?.channelId) {
        await interaction.editReply({ content: 'ℹ️ Önce `/ses katil` ile bir ses kanalı kaydet.' });
        return;
      }

      const result = await voice.joinVoiceChannel(client, interaction.guild, settings.voice.channelId, {
        selfMute: settings.voice.selfMute ?? true,
        selfDeaf: settings.voice.selfDeaf ?? true
      });

      const channel = interaction.guild.channels.cache.get(settings.voice.channelId);
      await interaction.editReply({ content: result.ok ? `✅ Bot #${channel?.name || settings.voice.channelId} kanalına yeniden bağlandı.` : `❌ Yeniden bağlanılamadı: ${result.error || 'bilinmiyor'}` });
      return;
    }

    await interaction.editReply({ content: '❌ Bilinmeyen alt komut.' });
  }
};
