import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';

@ApplyOptions<Command.Options>({
	name: 'volume',
	description: 'Change playback volume level.',
})
export class VolumeCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('volume')
				.setDescription('Change playback volume level.')
				.addIntegerOption((o) =>
					o
						.setName('level')
						.setDescription('Volume level (0–200, default: 100).')
						.setMinValue(0)
						.setMaxValue(200)
						.setRequired(false),
				),
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const { VolumeHandler } = await import('../../lib/music/handlers/volume.js');
		return new VolumeHandler().chatInputRun(interaction);
	}
}
