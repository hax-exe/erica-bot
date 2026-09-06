import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';

@ApplyOptions<Command.Options>({
	name: 'resume',
	description: 'Resume the paused playback.',
})
export class ResumeCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder.setName('resume').setDescription('Resume the paused playback.'),
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const { ResumeHandler } = await import('../../lib/music/handlers/resume.js');
		return new ResumeHandler().chatInputRun(interaction);
	}
}
