import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';

@ApplyOptions<Command.Options>({
	name: 'stop',
	description: 'Stop playback, clear queue, and leave voice channel.',
})
export class StopCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder.setName('stop').setDescription('Stop playback, clear queue, and leave voice channel.'),
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const { StopHandler } = await import('../../lib/music/handlers/stop.js');
		return new StopHandler().chatInputRun(interaction);
	}
}
