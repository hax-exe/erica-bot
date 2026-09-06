import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';

@ApplyOptions<Command.Options>({
	name: 'queue',
	description: 'Show the current music queue.',
})
export class QueueCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder.setName('queue').setDescription('Show the current music queue.'),
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const { QueueHandler } = await import('../../lib/music/handlers/queue.js');
		return new QueueHandler().chatInputRun(interaction);
	}
}
