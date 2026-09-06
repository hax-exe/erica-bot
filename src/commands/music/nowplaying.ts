import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';

@ApplyOptions<Command.Options>({
	name: 'nowplaying',
	description: 'Show information about the currently playing track.',
})
export class NowPlayingCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder.setName('nowplaying').setDescription('Show information about the currently playing track.'),
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const { NowPlayingHandler } = await import('../../lib/music/handlers/nowplaying.js');
		return new NowPlayingHandler().chatInputRun(interaction);
	}
}
