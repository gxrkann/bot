import { REST, Routes } from 'discord.js';
import { config } from './config.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const commands = [];
const commandFiles = fs.readdirSync(path.join(__dirname, 'commands')).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = await import(pathToFileURL(path.join(__dirname, 'commands', file)).href);
  commands.push(command.default.data.toJSON());
}

function pathToFileURL(filePath) {
  return new URL(`file://${filePath.replace(/\\/g, '/')}`);
}

const rest = new REST({ version: '10' }).setToken(config.token);

(async () => {
  try {
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands });
    console.log('Commands registered.');
  } catch (error) {
    console.error(error);
  }
})();
