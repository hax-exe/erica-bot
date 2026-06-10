import { EmbedBuilder, type APIEmbed } from 'discord.js';

const BRAND_COLOR = 0x7c3aed;
const SUCCESS_COLOR = 0x22c55e;
const ERROR_COLOR = 0xef4444;
const INFO_COLOR = 0x3b82f6;
const WARN_COLOR = 0xeab308;

export class EricaEmbed extends EmbedBuilder {
  public constructor(data?: APIEmbed) {
    super(data);
    this.setColor(BRAND_COLOR);
    this.setFooter({ text: 'Erica' });
    this.setTimestamp(new Date());
  }

  public static success(description?: string): EricaEmbed {
    const embed = new EricaEmbed();
    embed.setColor(SUCCESS_COLOR);
    if (description) embed.setDescription(`✅ ${description}`);
    return embed;
  }

  public static error(description?: string): EricaEmbed {
    const embed = new EricaEmbed();
    embed.setColor(ERROR_COLOR);
    if (description) embed.setDescription(`❌ ${description}`);
    return embed;
  }

  public static info(description?: string): EricaEmbed {
    const embed = new EricaEmbed();
    embed.setColor(INFO_COLOR);
    if (description) embed.setDescription(`ℹ️ ${description}`);
    return embed;
  }

  public static warn(description?: string): EricaEmbed {
    const embed = new EricaEmbed();
    embed.setColor(WARN_COLOR);
    if (description) embed.setDescription(`⚠️ ${description}`);
    return embed;
  }
}
