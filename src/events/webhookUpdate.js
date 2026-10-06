import { Events, AuditLogEvent } from 'discord.js';
import { getGuildSettings, sendGuardLog } from '../guard-utils.js';
import { inspectAction } from '../anti-nuke.js';

export default {
  name: Events.WebhookUpdate,
  async execute(newWebhook, oldWebhook, client) {
    const guild = newWebhook?.guild;
    if (!guild) return;
    const settings = getGuildSettings(client, guild.id);
    if (!settings.enabled) return;

    await sendGuardLog(client, guild, '🪝 Webhook güncellendi', `Webhook: ${newWebhook.name}`, 0xfaa61a);

    await inspectAction(client, guild, 'webhookUpdate', newWebhook.id, AuditLogEvent.WebhookUpdate).catch(() => null);
  }
};

export { AuditLogEvent };
