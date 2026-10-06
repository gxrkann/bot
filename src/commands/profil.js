import { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, PermissionFlagsBits } from 'discord.js';
import {
  setAvatar, setBanner, removeAvatar, removeBanner, setActivity, getProfileInfo,
  validateImage, ACTIVITY_TYPES, ACTIVITY_LABELS, STATUS_OPTIONS
} from '../profile.js';
import { isAuthorizedOwner } from '../guard-utils.js';

/**
 * Attachment nesnesini Buffer'a çevirir.
 *
 * discord.js v14'te API sürüme göre değişiyor: bazı sürümlerde
 * `attachment.arrayBuffer()` (web fetch arayüzü), bazılarında
 * `attachment.data`, bazılarında `attachment.attachment()` var.
 * Tek bir yol varsaymak runtime hatası veriyor, hepsini deniyoruz.
 */
async function attachmentToBuffer(attachment) {
  if (!attachment) return null;

  // 1) Zaten Buffer ise doğrudan kullan
  if (Buffer.isBuffer(attachment)) return attachment;

  // 2) v14.16+: .data özelliği (Buffer)
  if (attachment.data && Buffer.isBuffer(attachment.data)) return attachment.data;

  // 3) .data getter metod ise çağır
  if (typeof attachment.data === 'function') {
    const data = await attachment.data();
    if (Buffer.isBuffer(data)) return data;
  }

  // 4) .attachment() -> Promise<Buffer>
  if (typeof attachment.attachment === 'function') {
    const data = await attachment.attachment();
    if (Buffer.isBuffer(data)) return data;
  }

  // 5) Fetch benzeri arayüz
  if (typeof attachment.arrayBuffer === 'function') {
    return Buffer.from(await attachment.arrayBuffer());
  }

  // 6) Node.js stream
  if (typeof attachment.stream === 'function') {
    const chunks = [];
    for await (const chunk of attachment.stream()) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  return null;
}

export default {
  data: new SlashCommandBuilder()
    .setName('profil')
    .setDescription('Botun avatarını, bannerını ve profil yazısını yönet')
    .addSubcommand((sub) => sub
      .setName('gorunum')
      .setDescription('Avatar, banner ve etkinlik durumunu göster'))
    .addSubcommand((sub) => sub
      .setName('avatar')
      .setDescription('Botun profil fotoğrafını değiştir')
      .addAttachmentOption((option) => option
        .setName('gorsel')
        .setDescription('PNG veya JPEG, en az 128x128 (önerilen 512x512)')
        .setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('avatar-kaldir')
      .setDescription('Profil fotoğrafını varsayılana döndür'))
    .addSubcommand((sub) => sub
      .setName('banner')
      .setDescription('Botun bannerını değiştir')
      .addAttachmentOption((option) => option
        .setName('gorsel')
        .setDescription('PNG veya JPEG, en az 600x240 (önerilen 1200x480)')
        .setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('banner-kaldir')
      .setDescription('Bannerı kaldır'))
    .addSubcommand((sub) => sub
      .setName('oyun')
      .setDescription('Profil altında görünecek yazıyı ayarla')
      .addStringOption((option) => option
        .setName('yazi')
        .setDescription('Örnek: 5 sunucuyu koruyor. Boş bırakırsan kaldırılır.')
        .setMaxLength(128)
        .setRequired(true))
      .addStringOption((option) => option
        .setName('tur')
        .setDescription('Yazının önündeki etiket')
        .addChoices(
          { name: 'Playing (oynuyor)', value: 'playing' },
          { name: 'Watching (izliyor)', value: 'watching' },
          { name: 'Listening (dinliyor)', value: 'listening' },
          { name: 'Competing (yarışıyor)', value: 'competing' },
          { name: 'Custom (sadece yazı)', value: 'custom' }
        )
        .setRequired(true))
      .addStringOption((option) => option
        .setName('durum')
        .setDescription('Botun görünür durumu')
        .addChoices(
          { name: 'Çevrimiçi', value: 'online' },
          { name: 'Görünmez', value: 'idle' },
          { name: 'Meşgul', value: 'dnd' },
          { name: 'Tamamen gizli', value: 'invisible' }
        )
        .setRequired(false))),

  async execute(interaction, client) {
    /* Tüm alt komutlar yalnızca bot sahibine açık.
       Profil değişiklikleri sunucuyu etkilemese de biri botu taklit edebilir. */
    if (!isAuthorizedOwner(client, interaction.user.id)) {
      return interaction.reply({
        content: '⚠️ Bu komut sadece bot sahipleri tarafından kullanılabilir.',
        flags: 64
      });
    }

    await interaction.deferReply();

    const sub = interaction.options.getSubcommand();

    /* ---------------- Görünüm ---------------- */
    if (sub === 'gorunum') {
      const info = getProfileInfo(client);
      if (!info) {
        return interaction.editReply('Bot profili okunamadı.');
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('Bot Profili')
        .setThumbnail(info.avatarUrl)
        .addFields(
          { name: 'Kullanıcı adı', value: `${info.displayName} (${info.tag})`, inline: true },
          { name: 'Bot ID', value: info.id, inline: true },
          { name: 'Durum', value: STATUS_OPTIONS[info.status] || info.status, inline: true },
          { name: 'Avatar', value: '✅ Var' , inline: true },
          { name: 'Banner', value: info.hasBanner ? '✅ Var' : '❌ Yok', inline: true },
          {
            name: 'Profil yazısı',
            value: info.activities.length
              ? info.activities.map((a) => `${a.type}: ${a.name}`).join('\n')
              : '❌ Ayarlanmamış',
            inline: false
          }
        );

      if (info.hasBanner) {
        embed.setImage(info.bannerUrl);
      }

      return interaction.editReply({ embeds: [embed] });
    }

    /* ---------------- Avatar ---------------- */
    if (sub === 'avatar') {
      const attachment = interaction.options.getAttachment('gorsel', true);
      const buffer = await attachmentToBuffer(attachment);

      if (!buffer) {
        return interaction.editReply('❌ Görsel okunamadı. Dosya bozuk olabilir.');
      }

      const check = validateImage(buffer, 'avatar');
      if (!check.ok) {
        return interaction.editReply(`❌ ${check.error}`);
      }

      const result = await setAvatar(client, buffer);
      if (!result.ok) return interaction.editReply(`❌ ${result.error}`);

      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('✅ Avatar güncellendi')
        .setDescription(`${check.size.width}x${check.size.height} ${check.size.type} yüklendi.`)
        .setImage(`${client.user.displayAvatarURL({ size: 512 })}?t=${Date.now()}`);

      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'avatar-kaldir') {
      const result = await removeAvatar(client);
      if (!result.ok) return interaction.editReply(`❌ ${result.error}`);
      return interaction.editReply('✅ Avatar varsayılana döndürüldü.');
    }

    /* ---------------- Banner ---------------- */
    if (sub === 'banner') {
      const attachment = interaction.options.getAttachment('gorsel', true);
      const buffer = await attachmentToBuffer(attachment);

      if (!buffer) {
        return interaction.editReply('❌ Görsel okunamadı. Dosya bozuk olabilir.');
      }

      const check = validateImage(buffer, 'banner');
      if (!check.ok) {
        return interaction.editReply(`❌ ${check.error}`);
      }

      const result = await setBanner(client, buffer);
      if (!result.ok) return interaction.editReply(`❌ ${result.error}`);

      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('✅ Banner güncellendi')
        .setDescription(`${check.size.width}x${check.size.height} ${check.size.type} yüklendi.`);

      if (client.user.bannerURL({ size: 600 })) {
        embed.setImage(`${client.user.bannerURL({ size: 600 })}?t=${Date.now()}`);
      }

      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'banner-kaldir') {
      const result = await removeBanner(client);
      if (!result.ok) return interaction.editReply(`❌ ${result.error}`);
      return interaction.editReply('✅ Banner kaldırıldı.');
    }

    /* ---------------- Oyun adı ---------------- */
    if (sub === 'oyun') {
      const text = interaction.options.getString('yazi');
      const type = interaction.options.getString('tur');
      const status = interaction.options.getString('durum');

      /* "kaldır" yazılırsa etkinliği temizle */
      const wantsRemoval = text.trim().toLowerCase() === 'kaldir' || text.trim() === '-';

      const result = await setActivity(client, {
        text: wantsRemoval ? '' : text,
        type,
        status
      });

      if (!result.ok) return interaction.editReply(`❌ ${result.error}`);

      if (wantsRemoval) {
        return interaction.editReply('✅ Profil yazısı kaldırıldı.');
      }

      return interaction.editReply({
        content: `✅ Profil yazısı ayarlandı.\n**${ACTIVITY_LABELS[type]}:** ${text}${status ? `\n**Durum:** ${STATUS_OPTIONS[status]}` : ''}`
      });
    }
  }
};

export { PermissionFlagsBits, AttachmentBuilder, ACTIVITY_TYPES };

/** Testler için: attachment okuma yollarını doğrulamak amacıyla. */
export const __test = { attachmentToBuffer };
