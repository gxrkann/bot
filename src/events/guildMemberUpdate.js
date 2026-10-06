import { Events, AuditLogEvent } from 'discord.js';
import { sendGuardLog, getGuildSettings, addSuspect, removeSuspect, recordAction } from '../guard-utils.js';
import { inspectRoleChange } from '../anti-nuke.js';

export default {
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember, client) {
    const guild = newMember?.guild;
    if (!guild) return;
    const settings = getGuildSettings(client, guild.id);
    if (!settings.enabled) return;

    if (oldMember.communicationDisabledUntilTimestamp !== newMember.communicationDisabledUntilTimestamp) {
      await sendGuardLog(client, guild, '⏱️ Zaman aşımı güncellendi', `Kullanıcı: ${newMember.user.tag}`, 0xfaa61a);
    }

    const oldPermissions = oldMember.permissions.serialize();
    const newPermissions = newMember.permissions.serialize();
    if (JSON.stringify(oldPermissions) !== JSON.stringify(newPermissions)) {
      await sendGuardLog(client, guild, '🔐 İzinler değiştirildi', `Kullanıcı: ${newMember.user.tag}`, 0xfaa61a);
    }

    const addedRole = newMember.roles.cache.find((role) => !oldMember.roles.cache.has(role.id));
    const removedRole = oldMember.roles.cache.find((role) => !newMember.roles.cache.has(role.id));
    if (addedRole || removedRole) {
      await sendGuardLog(client, guild, '🎭 Roller değiştirildi', `Kullanıcı: ${newMember.user.tag}`, 0xfaa61a);

      /* Toplu rol verme tespiti: kısa sürede çok sayıda rol değişimi olursa
         (bir yönetici script'i çalıştırmış olabilir) loglanır.
         Bu kontrol roleMembersUpdate.js'den taşındı — dosya GuildMemberUpdate
         event'ini zaten dinliyordu ve mükerrer kayıt olarak atlanıyordu. */
      if (addedRole && !removedRole) {
        const spammed = recordAction(
          client, guild.id, 'role-add',
          settings.actionThreshold ?? 5,
          settings.actionWindowMs ?? 10000
        );
        if (spammed) {
          await sendGuardLog(
            client, guild,
            '⚠️ Toplu rol verme tespit edildi',
            `${settings.actionThreshold} rol değişimi ${Math.round((settings.actionWindowMs ?? 10000) / 1000)} saniye içinde yapıldı.\nKullanıcı: ${newMember.user.tag}`,
            0xed4245
          );
        }
      }

      /* Quarantine koruması: karantineli üyeye rol verilmeye çalışılıyorsa
         saldırgan karantinelenir. */
      if (addedRole) {
        await inspectRoleChange(client, guild, newMember, addedRole, AuditLogEvent.MemberRoleAdd).catch(() => null);
      }

      try {
        if (addedRole && settings.suspectRoleId && addedRole.id === settings.suspectRoleId) {
          await addSuspect(client, guild.id, {
            userId: newMember.user.id,
            userTag: newMember.user.tag,
            joinedAt: Date.now(),
            reasons: ['role assigned: suspect'],
            addedBy: 'role'
          });
          await sendGuardLog(client, guild, '⚠️ Şüpheli rol verildi', `Kullanıcı: ${newMember.user.tag}`, 0xed4245);
        }

        if (removedRole && settings.suspectRoleId && removedRole.id === settings.suspectRoleId) {
          await removeSuspect(client, guild.id, newMember.user.id).catch(() => null);
          await sendGuardLog(client, guild, '✅ Şüpheli rol kaldırıldı', `Kullanıcı: ${newMember.user.tag} artık şüpheli değil.`, 0x57f287);
        }
      } catch {
        // ignore
      }
    }
  }
};
