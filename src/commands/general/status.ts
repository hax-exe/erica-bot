import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { MessageFlags } from 'discord.js';
import { errorReply } from '../../lib/components.js';
import { replyActiveIncidents } from '../../lib/StatusAdmin.js';

/**
 * Public, read-only view of the global status page.
 * Owner-only management (panel, refresh, reload, maintenance, service overrides, incidents)
 * lives under `/admin status ...` — see src/lib/StatusAdmin.ts.
 */
@ApplyOptions<Subcommand.Options>({
	name: 'status',
	description: 'View the system status page.',
	subcommands: [{ name: 'incidents', chatInputRun: 'chatInputIncidents' }],
})
export class StatusCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('status')
				.setDescription('View the system status page.')
				.addSubcommand((sub) => sub.setName('incidents').setDescription('List active status incidents.')),
		);
	}

	// ── /status incidents ──────────────────────────────────────────────────────
	public async chatInputIncidents(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Guild only.'));
		return replyActiveIncidents(interaction);
	}
}
