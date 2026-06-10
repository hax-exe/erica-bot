import { Precondition } from '@sapphire/framework';
import type { ChatInputCommandInteraction, GuildMember } from 'discord.js';

export class VoiceChannelPrecondition extends Precondition {
  public constructor(context: Precondition.LoaderContext, options: Precondition.Options) {
    super(context, {
      ...options,
      name: 'VoiceChannel'
    });
  }

  public override chatInputRun(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as GuildMember;

    if (!member) {
      return this.error({ message: 'This command can only be used in a server.' });
    }

    if (!member.voice.channel) {
      return this.error({ message: 'You need to be in a voice channel to use this command.' });
    }

    return this.ok();
  }
}

declare module '@sapphire/framework' {
  interface Preconditions {
    VoiceChannel: never;
  }
}
