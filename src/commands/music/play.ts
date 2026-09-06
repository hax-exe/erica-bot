import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';

@ApplyOptions<Command.Options>({
	name: 'play',
	description: 'Play a song or add it to the queue.',
})
export class PlayCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('play')
				.setDescription('Play a song or add it to the queue.')
				.addStringOption((o) =>
					o
						.setName('query')
						.setDescription('Song name, URL, or playlist link.')
						.setRequired(true)
						.setAutocomplete(true),
				),
		);
	}

	public override async autocompleteRun(interaction: any) {
		const { PlayHandler } = await import('../../lib/music/handlers/play.js');
		return new PlayHandler().autocompleteRun(interaction);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const { PlayHandler } = await import('../../lib/music/handlers/play.js');
		return new PlayHandler().chatInputRun(interaction);
	}
}
