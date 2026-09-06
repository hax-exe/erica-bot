import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';

@ApplyOptions<Command.Options>({
	name: 'skip',
	description: 'Skip the current track.',
})
export class SkipCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('skip')
				.setDescription('Skip the current track.')
				.addIntegerOption((o) =>
					o
						.setName('to')
						.setDescription('Skip directly to a specific queue position.')
						.setMinValue(1)
						.setRequired(false),
				),
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const { SkipHandler } = await import('../../lib/music/handlers/skip.js');
		return new SkipHandler().chatInputRun(interaction);
	}
}
