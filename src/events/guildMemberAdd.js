import { Events, AuditLogEvent } from 'discord.js';
import { getGuildSettings, sendGuardLog } from '../guard-utils.js';
import { inspectAction } from '../anti-nuke.js';
import { runJoinGate } from '../join-gate.js';
import { trackJoin } from '../join-raid.js';
import { needsVerification, startVerification } from '../verification.js';
import { addSuspect, evaluateMember } from '../guard-utils.js';

export default {
  name: Events.GuildMemberAdd,
  async execute(member, client) {
    const guild = member?.guild;
    if (!guild) return;
    const settings = getGuildSettings(client, guild.id);
    if (!settings.enabled) return;

    /* --- Join Gate: her filtre bağımsız çalışır --- */
    const gateResults = await runJoinGate(client, guild, member, settings);

    /* --- Join Raid: toplu katılım sayacı --- */
    await trackJoin(client, guild, member, settings).catch(() => null);

    /* --- Şüpheli listesi --- */
    const evaluation = evaluateMember(member, settings);
    if (evaluation.shouldList && !member.user.bot) {
      await addSuspect(client, guild.id, {
        userId: member.id,
        userTag: member.user.tag,
        joinedAt: Date.now(),
        reasons: evaluation.allReasons,
        addedBy: 'system'
      });

      // Kelime eşleşmesi varsa rol ver ama ceza uygulama.
      if (evaluation.shouldPunish && settings.suspectRoleId) {
        const role = guild.roles.cache.get(settings.suspectRoleId);
        if (role) await member.roles.add(role, 'Şüpheli olarak işaretlendi').catch(() => null);
      }
    }

    /* --- Doğrulama --- */
    if (!gateResults.some((item) => item.action !== 'log')) {
      if (needsVerification(member, settings)) {
        await startVerification(client, guild, member, settings).catch(() => null);
      }
    }

    /* Botları doğrulamaya sokma. */
    if (member.user.bot) return;
  }
};

export { AuditLogEvent, inspectAction };
