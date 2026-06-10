import { Command } from '@sapphire/framework';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import { EricaEmbed } from '../../lib/utils/embed.js';

interface TriviaQuestion {
  category: string;
  type: string;
  difficulty: string;
  question: string;
  correct_answer: string;
  incorrect_answers: string[];
}

interface TriviaResponse {
  response_code: number;
  results: TriviaQuestion[];
}

const LETTER_LABELS = ['A', 'B', 'C', 'D'] as const;

function decodeHtml(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#039;': "'",
    '&apos;': "'",
    '&ldquo;': '\u201C',
    '&rdquo;': '\u201D',
    '&lsquo;': '\u2018',
    '&rsquo;': '\u2019',
    '&hellip;': '\u2026',
    '&eacute;': '\u00E9',
    '&ntilde;': '\u00F1',
    '&uuml;': '\u00FC',
    '&ouml;': '\u00F6',
    '&auml;': '\u00E4',
    '&szlig;': '\u00DF',
    '&Eacute;': '\u00C9'
  };

  return text.replace(/&[^;]+;/g, (match) => entities[match] ?? match);
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = temp;
  }
  return shuffled;
}

export class TriviaCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'trivia',
      description: 'Answer a trivia question'
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName('trivia')
        .setDescription('Answer a trivia question')
        .addStringOption((opt) =>
          opt
            .setName('difficulty')
            .setDescription('Question difficulty')
            .setRequired(false)
            .addChoices(
              { name: 'Easy', value: 'easy' },
              { name: 'Medium', value: 'medium' },
              { name: 'Hard', value: 'hard' }
            )
        )
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    await interaction.deferReply();

    const difficulty = interaction.options.getString('difficulty');
    const url = `https://opentdb.com/api.php?amount=1&type=multiple${difficulty ? `&difficulty=${difficulty}` : ''}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        return interaction.editReply({
          embeds: [EricaEmbed.error().setDescription('Failed to fetch a trivia question. Please try again later.')]
        });
      }

      const data = (await response.json()) as TriviaResponse;

      if (data.response_code !== 0 || data.results.length === 0) {
        return interaction.editReply({
          embeds: [EricaEmbed.error().setDescription('No trivia questions available. Please try again later.')]
        });
      }

      const question = data.results[0];

      if (!question) {
        return interaction.editReply({
          embeds: [EricaEmbed.error().setDescription('No trivia questions available. Please try again later.')]
        });
      }

      const decodedQuestion = decodeHtml(question.question);
      const decodedCorrect = decodeHtml(question.correct_answer);
      const decodedIncorrect = question.incorrect_answers.map(decodeHtml);

      const allAnswers = shuffleArray([decodedCorrect, ...decodedIncorrect]);
      const correctIndex = allAnswers.indexOf(decodedCorrect);

      const difficultyEmoji: Record<string, string> = {
        easy: '🟢 Easy',
        medium: '🟡 Medium',
        hard: '🔴 Hard'
      };

      const questionEmbed = new EricaEmbed()
        .setTitle('🧠 Trivia Time!')
        .setDescription(decodedQuestion)
        .addFields(
          { name: 'Category', value: decodeHtml(question.category), inline: true },
          { name: 'Difficulty', value: difficultyEmoji[question.difficulty] ?? question.difficulty, inline: true },
          {
            name: 'Answers',
            value: allAnswers.map((answer, i) => `**${LETTER_LABELS[i]!}.** ${answer}`).join('\n'),
            inline: false
          }
        )
        .setFooter({ text: 'You have 30 seconds to answer!' });

      const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        allAnswers.map((_, i) =>
          new ButtonBuilder()
            .setCustomId(`trivia_${i}`)
            .setLabel(LETTER_LABELS[i]!)
            .setStyle(ButtonStyle.Primary)
        )
      );

      const message = await interaction.editReply({ embeds: [questionEmbed], components: [buttons] });

      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: (i) => i.user.id === interaction.user.id,
        time: 30_000,
        max: 1
      });

      collector.on('collect', async (buttonInteraction) => {
        const selectedIndex = parseInt(buttonInteraction.customId.split('_')[1]!, 10);
        const isCorrect = selectedIndex === correctIndex;

        const disabledButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
          allAnswers.map((_, i) =>
            new ButtonBuilder()
              .setCustomId(`trivia_${i}`)
              .setLabel(LETTER_LABELS[i]!)
              .setStyle(
                i === correctIndex
                  ? ButtonStyle.Success
                  : i === selectedIndex
                    ? ButtonStyle.Danger
                    : ButtonStyle.Secondary
              )
              .setDisabled(true)
          )
        );

        const resultEmbed = isCorrect
          ? EricaEmbed.success()
               .setTitle('🎉 Correct!')
               .setDescription(`**${LETTER_LABELS[correctIndex]!}.** ${decodedCorrect} is the right answer!`)
           : EricaEmbed.error()
               .setTitle('❌ Incorrect!')
               .setDescription(
                 `You selected **${LETTER_LABELS[selectedIndex]!}.** ${allAnswers[selectedIndex] ?? 'Unknown'}\n` +
                 `The correct answer was **${LETTER_LABELS[correctIndex]!}.** ${decodedCorrect}`
              );

        await buttonInteraction.update({ embeds: [questionEmbed, resultEmbed], components: [disabledButtons] });
      });

      collector.on('end', async (collected) => {
        if (collected.size === 0) {
          const disabledButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
            allAnswers.map((_, i) =>
              new ButtonBuilder()
                .setCustomId(`trivia_${i}`)
                .setLabel(LETTER_LABELS[i]!)
                .setStyle(i === correctIndex ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setDisabled(true)
            )
          );

          const timeoutEmbed = EricaEmbed.warn()
            .setTitle('⏰ Time\'s Up!')
             .setDescription(`The correct answer was **${LETTER_LABELS[correctIndex]!}.** ${decodedCorrect}`);

          await interaction.editReply({ embeds: [questionEmbed, timeoutEmbed], components: [disabledButtons] });
        }
      });
    } catch {
      return interaction.editReply({
        embeds: [EricaEmbed.error().setDescription('Failed to fetch a trivia question. Please try again later.')]
      });
    }
  }
}
