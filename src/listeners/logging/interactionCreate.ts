import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { channelMention, Events, type Interaction, userMention } from 'discord.js';
import { Colors, logContainer } from '../../lib/components.js';
import { formatUser, sendLog } from '../../lib/LoggingUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'interactionCreateLogging',
	event: Events.InteractionCreate,
})
export class InteractionCreateListener extends Listener<typeof Events.InteractionCreate> {
	public override async run(interaction: Interaction) {
		if (!interaction.guild || interaction.user.bot) return;
		if (!(await isModuleEnabled(interaction.guild.id, 'logging'))) return;

		const userValue = `${formatUser(interaction.user.id, interaction.user.username)}`;
		const channelValue = interaction.channelId ? channelMention(interaction.channelId) : '*(unknown)*';

		if (interaction.isChatInputCommand()) {
			const subgroup = interaction.options.getSubcommandGroup(false);
			const subcommand = interaction.options.getSubcommand(false);
			const name = [interaction.commandName, subgroup, subcommand].filter(Boolean).join(' ');
			return sendLog(
				interaction.guild,
				logContainer({
					title: 'Slash Command Used',
					color: Colors.Neutral,
					fields: [
						{ name: 'User', value: userValue },
						{ name: 'Command', value: `\`/${name}\`` },
						{ name: 'Channel', value: channelValue },
					],
					timestamp: true,
				}),
				interaction.channelId ?? undefined,
			).catch(() => null);
		}

		if (interaction.isUserContextMenuCommand() || interaction.isMessageContextMenuCommand()) {
			return sendLog(
				interaction.guild,
				logContainer({
					title: 'Context Menu Used',
					color: Colors.Neutral,
					fields: [
						{ name: 'User', value: userValue },
						{ name: 'Command', value: `\`${interaction.commandName}\`` },
						{ name: 'Channel', value: channelValue },
					],
					timestamp: true,
				}),
				interaction.channelId ?? undefined,
			).catch(() => null);
		}
	}
}
