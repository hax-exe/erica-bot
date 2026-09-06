import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { MessageFlags, PermissionFlagsBits, TextDisplayBuilder } from 'discord.js';
import { Colors, CV2_FLAG, errorReply, makeContainer, meta, separator, successReply } from '../../lib/components.js';
import { getOrCreateModules, MODULE_LABELS, MODULES, type Module, setModule } from '../../lib/ModuleUtil.js';

const MODULE_CHOICES = MODULES.map((m) => ({ name: MODULE_LABELS[m], value: m }));

@ApplyOptions<Command.Options>({
	name: 'module',
	description: 'Enable or disable bot modules for this server.',
	preconditions: ['Moderation'],
})
export class ModuleCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('module')
				.setDescription('Enable or disable bot modules for this server.')
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
				.addSubcommand((sub) =>
					sub
						.setName('enable')
						.setDescription('Enable a module.')
						.addStringOption((o) =>
							o
								.setName('module')
								.setDescription('The module to enable.')
								.setRequired(true)
								.addChoices(...MODULE_CHOICES),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('disable')
						.setDescription('Disable a module.')
						.addStringOption((o) =>
							o
								.setName('module')
								.setDescription('The module to disable.')
								.setRequired(true)
								.addChoices(...MODULE_CHOICES),
						),
				)
				.addSubcommand((sub) => sub.setName('list').setDescription('Show the status of all modules.')),
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const sub = interaction.options.getSubcommand();

		if (sub === 'enable' || sub === 'disable') {
			const mod = interaction.options.getString('module', true) as Module;
			const enabled = sub === 'enable';
			await setModule(interaction.guildId, mod, enabled);
			return interaction.editReply(successReply(`**${MODULE_LABELS[mod]}** ${enabled ? 'enabled' : 'disabled'}.`));
		}

		const row = await getOrCreateModules(interaction.guildId);

		const on: string[] = [];
		const off: string[] = [];
		for (const m of MODULES) {
			(row[m] !== false ? on : off).push(MODULE_LABELS[m]);
		}

		const container = makeContainer({ color: Colors.Info, header: 'Modules' });
		container.addSeparatorComponents(separator());

		if (on.length) {
			container.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(`**Enabled (${on.length})**\n${on.join(' · ')}`),
			);
		}
		if (off.length) {
			if (on.length) container.addSeparatorComponents(separator());
			container.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(`**Disabled (${off.length})**\n${off.join(' · ')}`),
			);
		}

		container.addSeparatorComponents(separator());
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(meta('Use /module enable or /module disable to toggle')),
		);

		return interaction.editReply({ components: [container], flags: CV2_FLAG });
	}
}
