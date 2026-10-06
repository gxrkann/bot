import { SlashCommandBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Botun gecikmesini kontrol et.'),
  async execute(interaction) {
    await interaction.reply({ content: `Pong! ${Date.now() - interaction.createdTimestamp}ms`, flags: 64 });
  }
};
