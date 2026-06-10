import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type EmbedBuilder,
  type Message,
  type CommandInteraction,
  type MessageComponentInteraction,
} from 'discord.js';

const DEFAULT_TIMEOUT = 60_000;

export class Paginator {
  private readonly pages: EmbedBuilder[];
  private currentPage: number;
  private readonly timeout: number;

  public constructor(pages: EmbedBuilder[], timeout: number = DEFAULT_TIMEOUT) {
    if (pages.length === 0) {
      throw new Error('Paginator requires at least one page.');
    }
    this.pages = pages;
    this.currentPage = 0;
    this.timeout = timeout;
  }

  private createButtons(disabled: boolean = false): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('paginator_prev')
        .setLabel('◀ Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || this.currentPage === 0),
      new ButtonBuilder()
        .setCustomId('paginator_next')
        .setLabel('Next ▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || this.currentPage === this.pages.length - 1),
      new ButtonBuilder()
        .setCustomId('paginator_close')
        .setLabel('✕ Close')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled),
    );
  }

  private getCurrentEmbed(): EmbedBuilder {
    return this.pages[this.currentPage]!.setFooter({
      text: `Erica • Page ${this.currentPage + 1}/${this.pages.length}`,
    });
  }

  public async send(interaction: CommandInteraction): Promise<void> {
    const reply = await interaction.reply({
      embeds: [this.getCurrentEmbed()],
      components: [this.createButtons()],
      fetchReply: true,
    });

    this.collectInteractions(reply, interaction.user.id);
  }

  public async sendAsMessage(message: Message): Promise<void> {
    const reply = await message.reply({
      embeds: [this.getCurrentEmbed()],
      components: [this.createButtons()],
    });

    this.collectInteractions(reply, message.author.id);
  }

  private collectInteractions(message: Message, userId: string): void {
    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: (i: MessageComponentInteraction) => i.user.id === userId,
      time: this.timeout,
    });

    collector.on('collect', async (i: MessageComponentInteraction) => {
      switch (i.customId) {
        case 'paginator_prev':
          this.currentPage = Math.max(0, this.currentPage - 1);
          break;
        case 'paginator_next':
          this.currentPage = Math.min(this.pages.length - 1, this.currentPage + 1);
          break;
        case 'paginator_close':
          collector.stop('closed');
          await i.update({
            embeds: [this.getCurrentEmbed()],
            components: [this.createButtons(true)],
          });
          return;
      }

      await i.update({
        embeds: [this.getCurrentEmbed()],
        components: [this.createButtons()],
      });
    });

    collector.on('end', async (_collected, reason) => {
      if (reason === 'closed') return;

      try {
        await message.edit({
          embeds: [this.getCurrentEmbed()],
          components: [this.createButtons(true)],
        });
      } catch {
        // Message may have been deleted
      }
    });
  }
}
