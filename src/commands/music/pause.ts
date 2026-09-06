import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';

@ApplyOptions<Command.Options>({
	name: 'pause',
	description: 'Pause the current playback.',
})
export class PauseCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder.setName('pause').setDescription('Pause the current playback.'),
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const { PauseHandler } = await import('../../lib/music/handlers/pause.js');
		return new PauseHandler().chatInputRun(interaction);
	}
}
