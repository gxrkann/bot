import { Events, AuditLogEvent } from 'discord.js';
import { getGuildSettings, sendGuardLog } from '../guard-utils.js';
import { inspectAction } from '../anti-nuke.js';

export default {
  // Discord her webhook güncellemesinde bir kez değil, sunucu başına bir kez
  // 'webhooksUpdate' yayımlar. WebhookUpdate ayrı bir olay değildir.
  name: Events.WebhooksUpdate,
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
