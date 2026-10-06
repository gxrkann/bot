import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getGuildSettings, saveGuildSettings, triggerLockdown, releaseLockdown, enableEmergencyMode, disableEmergencyMode, getSuspiciousTableUrl, buildSuspiciousActionRows } from '../guard-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backupDir = path.join(__dirname, '..', '..', 'data', 'backups');

async function respondToInteraction(interaction, payload) {
  try {
    if (interaction.deferred) {
      return await interaction.editReply(payload);
    }
    if (interaction.replied) {
      return await interaction.followUp(payload);
    }
    return await interaction.reply(payload);
  } catch (error) {
    const code = error?.code || error?.rawError?.code;
    if (code === 'InteractionNotReplied' || code === 'InteractionAlreadyReplied' || code === 'InteractionHasAlreadyBeenAcknowledged' || code === '40060') {
      try {
        return await interaction.followUp(payload);
      } catch {
        try {
          return await interaction.reply(payload);
        } catch {
          return null;
        }
      }
    }
    throw error;
  }
}

export default {
  data: new SlashCommandBuilder()
    .setName('guard')
    .setDescription('Koruma sistemini yönetin.')
    .addSubcommand((subcommand) => subcommand.setName('durum').setDescription('Mevcut koruma durumunu göster'))
    .addSubcommand((subcommand) => subcommand.setName('aktif').setDescription('Bu sunucu için korumayı aç'))
    .addSubcommand((subcommand) => subcommand.setName('pasif').setDescription('Bu sunucu için korumayı kapat'))
    .addSubcommand((subcommand) => subcommand
      .setName('ayar')
      .setDescription('Log kanalı ve güvenlik seviyesini ayarla')
      .addStringOption((option) => option.setName('logkanali').setDescription('Log kanalı adı veya ID').setRequired(false))
      .addStringOption((option) => option.setName('guvenlik').setDescription('Güvenlik seviyesi').addChoices({ name: 'Düşük', value: 'low' }, { name: 'Orta', value: 'medium' }, { name: 'Yüksek', value: 'high' }).setRequired(false))
      .addBooleanOption((option) => option.setName('antinuke').setDescription('Anti-nuke korumasını aç/kapat').setRequired(false))
      .addRoleOption((option) => option.setName('yetkilirolu').setDescription('Şüpheli işlemlerini yapabilecek rol').setRequired(false))
      .addRoleOption((option) => option.setName('guvenilirrolu').setDescription('Test geçtiğinde verilecek güvenilir rol').setRequired(false)))
    .addSubcommand((subcommand) => subcommand
      .setName('beyazliste')
      .setDescription('Güvenli kullanıcı veya rol ekle')
      .addUserOption((option) => option.setName('kullanici').setDescription('Güvenli kullanıcı').setRequired(false))
      .addRoleOption((option) => option.setName('rol').setDescription('Güvenli rol').setRequired(false)))
    .addSubcommand((subcommand) => subcommand.setName('listele').setDescription('Beyaz listedeki kullanıcı ve rolleri göster'))
    .addSubcommand((subcommand) => subcommand.setName('supheli').setDescription('Sunucudaki şüpheli kullanıcıları göster'))
    .addSubcommand((subcommand) => subcommand
      .setName('acil')
      .setDescription('Acil durum modunu aç/kapat')
      .addBooleanOption((option) => option.setName('etkin').setDescription('Acil durum modunu aç/kapat').setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName('kilit')
      .setDescription('Acil kilit modu aç/kapat')
      .addBooleanOption((option) => option.setName('etkin').setDescription('Kilit modunu aç/kapat').setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName('cezalandir')
      .setDescription('Bir kullanıcıya moderasyon cezası uygula')
      .addUserOption((option) => option.setName('kullanici').setDescription('Hedef kullanıcı').setRequired(true))
      .addStringOption((option) => option.setName('islem').setDescription('Uygulanacak işlem').addChoices({ name: 'Atma', value: 'kick' }, { name: 'Yasaklama', value: 'ban' }, { name: 'Zaman aşımı', value: 'timeout' }).setRequired(true))
      .addStringOption((option) => option.setName('neden').setDescription('Sebep').setRequired(false)))
    .addSubcommand((subcommand) => subcommand.setName('yedek').setDescription('Kanallar ve roller için basit bir yedek oluştur'))
    .addSubcommand((subcommand) => subcommand.setName('istatistik').setDescription('Koruma istatistiklerini göster')),
  async execute(interaction, client) {
    if (!interaction.guild || !interaction.member) return;

    const ownerIds = new Set([client.config?.ownerId, client.config?.ownerIds, process.env.OWNER_ID, process.env.OWNER_ID_2, process.env.OWNER_IDS]
      .filter(Boolean)
      .flatMap((value) => String(value).split(',').map((id) => id.trim()).filter(Boolean)));

    const isGuildOwner = interaction.guild.ownerId === interaction.user.id;
    const hasAdminPermission = interaction.member.permissions?.has(PermissionFlagsBits.Administrator) || interaction.member.permissions?.has(PermissionFlagsBits.ManageGuild);

    if (!ownerIds.has(interaction.user.id) && !isGuildOwner && !hasAdminPermission) {
      await respondToInteraction(interaction, { content: '⚠️ Bu komutlar sadece bot sahipleri, sunucu sahibi veya yönetici yetkisi olan kişiler tarafından kullanılabilir.', flags: 64 });
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    const settings = getGuildSettings(client, interaction.guildId);

    if (!interaction.deferred && !interaction.replied) {
      try {
        await interaction.deferReply({ flags: 64 });
      } catch {
        // ignore
      }
    }

    if (subcommand === 'aktif') {
      settings.enabled = true;
      await saveGuildSettings(client, interaction.guildId, settings);
      await respondToInteraction(interaction, { content: '🛡️ Koruma sistemi açıldı.' });
      return;
    }

    if (subcommand === 'pasif') {
      settings.enabled = false;
      await saveGuildSettings(client, interaction.guildId, settings);
      await respondToInteraction(interaction, { content: '🛡️ Koruma sistemi kapatıldı.' });
      return;
    }

    if (subcommand === 'ayar') {
      const logChannelInput = interaction.options.getString('logkanali');
      const security = interaction.options.getString('guvenlik');
      const antinuke = interaction.options.getBoolean('antinuke');
      const reviewRole = interaction.options.getRole('yetkilirolu');
      const trustedRole = interaction.options.getRole('guvenilirrolu');
      if (logChannelInput) {
        const channel = interaction.guild.channels.cache.find((item) => item.name === logChannelInput || item.id === logChannelInput);
        settings.logChannelId = channel?.id || logChannelInput;
      }
      if (security) settings.securityLevel = security;
      if (antinuke !== null) settings.antiNuke = antinuke;
      if (reviewRole) settings.reviewRoleId = reviewRole.id;
      if (trustedRole) settings.trustedRoleId = trustedRole.id;
      await saveGuildSettings(client, interaction.guildId, settings);
      await respondToInteraction(interaction, { content: '⚙️ Koruma ayarları güncellendi.' });
      return;
    }

    if (subcommand === 'supheli') {
      const suspects = settings.suspects || [];
      const embed = new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle('Şüpheli Kullanıcılar')
        .setDescription(suspects.length
          ? suspects.slice(0, 5).map((item, index) => `**${index + 1}.** <@${item.userId}> — ${item.userTag}\nNeden: ${item.reasons.join(', ')}`).join('\n\n')
          : 'Şu anda kayıtlı şüpheli kullanıcı bulunmuyor.')
        .addFields(
          { name: 'Google Tablo', value: `[Şüpheli Kişiler Tablosu](${getSuspiciousTableUrl()})` },
          { name: 'Not', value: 'Listede ilk 5 şüpheli gösteriliyor. Butonlarla işlem yapabilirsiniz.' }
        );

      const rows = buildSuspiciousActionRows(interaction.guildId, suspects);
      await respondToInteraction(interaction, { embeds: [embed], components: rows.length ? rows : [], allowedMentions: { users: [] } });
      return;
    }

    if (subcommand === 'beyazliste') {
      const user = interaction.options.getUser('kullanici');
      const role = interaction.options.getRole('rol');
      if (user) settings.safeUsers = [...new Set([...settings.safeUsers, user.id])];
      if (role) settings.safeRoles = [...new Set([...settings.safeRoles, role.id])];
      await saveGuildSettings(client, interaction.guildId, settings);
      await respondToInteraction(interaction, { content: '✅ Güvenli hedefler güncellendi.' });
      return;
    }

    if (subcommand === 'listele') {
      const safeUsers = await Promise.all(
        settings.safeUsers.map(async (id) => {
          try {
            const user = await client.users.fetch(id);
            return user.tag;
          } catch {
            return id;
          }
        })
      );
      const safeRoles = settings.safeRoles.map((roleId) => interaction.guild.roles.cache.get(roleId)?.name || roleId);
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('Beyaz Liste')
        .setDescription('Bu sunucu için kayıtlı güvenli kullanıcı ve roller')
        .addFields(
          { name: 'Kullanıcılar', value: safeUsers.length ? safeUsers.join('\n') : 'Henüz yok' },
          { name: 'Roller', value: safeRoles.length ? safeRoles.join('\n') : 'Henüz yok' }
        );
      await respondToInteraction(interaction, { embeds: [embed] });
      return;
    }

    if (subcommand === 'acil') {
      const enabled = interaction.options.getBoolean('etkin');
      settings.emergencyMode = enabled;
      await saveGuildSettings(client, interaction.guildId, settings);
      if (enabled) {
        await enableEmergencyMode(client, interaction.guild);
      } else {
        await disableEmergencyMode(client, interaction.guild);
      }
      await respondToInteraction(interaction, { content: enabled ? '🚨 Acil durum modu açıldı.' : '✅ Acil durum modu kapatıldı.' });
      return;
    }

    if (subcommand === 'kilit') {
      const enabled = interaction.options.getBoolean('etkin');
      settings.lockdown = enabled;
      await saveGuildSettings(client, interaction.guildId, settings);
      if (enabled) {
        await triggerLockdown(client, interaction.guild);
      } else {
        await releaseLockdown(client, interaction.guild);
      }
      await respondToInteraction(interaction, { content: enabled ? '🚨 Kilit modu açıldı.' : '✅ Kilit modu kapatıldı.' });
      return;
    }

    if (subcommand === 'cezalandir') {
      const target = interaction.options.getUser('kullanici');
      const action = interaction.options.getString('islem');
      const reason = interaction.options.getString('neden') || 'Koruma sistemi';
      const member = await interaction.guild.members.fetch(target.id).catch(() => null);
      if (!member) {
        await respondToInteraction(interaction, { content: '⚠️ Bu kullanıcı bu sunucuda değil.' });
        return;
      }
      if (action === 'timeout') {
        await member.timeout(600000, reason);
      } else if (action === 'kick') {
        await member.kick(reason);
      } else if (action === 'ban') {
        await member.ban({ reason });
      }
      await respondToInteraction(interaction, { content: `✅ ${target.tag} kullanıcısına ${action} işlemi uygulandı.` });
      return;
    }

    if (subcommand === 'yedek') {
      await fs.mkdir(backupDir, { recursive: true });
      const backupPath = path.join(backupDir, `${interaction.guildId}-${Date.now()}.json`);
      const payload = {
        guild: {
          id: interaction.guild.id,
          name: interaction.guild.name,
          ownerId: interaction.guild.ownerId
        },
        channels: interaction.guild.channels.cache.map((channel) => ({ id: channel.id, name: channel.name, type: channel.type })),
        roles: interaction.guild.roles.cache.map((role) => ({ id: role.id, name: role.name, color: role.color }))
      };
      await fs.writeFile(backupPath, JSON.stringify(payload, null, 2), 'utf8');
      await respondToInteraction(interaction, { content: `💾 Yedek oluşturuldu: ${backupPath}` });
      return;
    }

    if (subcommand === 'istatistik') {
      const embed = new EmbedBuilder()
        .setColor(settings.enabled ? 0x57f287 : 0xed4245)
        .setTitle('Koruma İstatistikleri')
        .setDescription('Bu sunucunun mevcut koruma durumu')
        .addFields(
          { name: 'Aktif', value: settings.enabled ? 'Evet' : 'Hayır' },
          { name: 'Anti-Nuke', value: settings.antiNuke ? 'Açık' : 'Kapalı' },
          { name: 'Acil Durum', value: settings.emergencyMode ? 'Açık' : 'Kapalı' },
          { name: 'Güvenli Kullanıcılar', value: String(settings.safeUsers.length) },
          { name: 'Güvenli Roller', value: String(settings.safeRoles.length) }
        );
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(settings.enabled ? 0x57f287 : 0xed4245)
      .setTitle('Koruma Durumu')
      .setDescription(settings.enabled ? 'Koruma sistemi şu anda açık.' : 'Koruma sistemi şu anda kapalı.')
      .addFields(
        { name: 'Güvenlik Seviyesi', value: settings.securityLevel || 'high' },
        { name: 'Log Kanalı', value: settings.logChannelId || 'Ayarlı değil' },
        { name: 'Kilit Modu', value: settings.lockdown ? 'Açık' : 'Kapalı' }
      );

    await interaction.editReply({ embeds: [embed] });
  }
};
