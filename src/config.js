import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '..', '.env');

dotenv.config({ path: envPath });

function parseOwnerIds() {
  const rawValues = [process.env.OWNER_ID, process.env.OWNER_ID_2, process.env.OWNER_IDS]
    .filter(Boolean)
    .flatMap((value) => String(value).split(',').map((id) => id.trim()).filter(Boolean));

  return [...new Set(rawValues)];
}

const ownerIds = parseOwnerIds();

export const config = {
  token: process.env.DISCORD_TOKEN || '',
  clientId: process.env.CLIENT_ID || '',
  guildId: process.env.GUILD_ID || '',
  ownerId: ownerIds[0] || '',
  ownerIds,
  botName: process.env.BOT_NAME || 'AxionV',
  defaultLogChannel: process.env.DEFAULT_LOG_CHANNEL || ''
};
