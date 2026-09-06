import * as discordTranscripts from 'discord-html-transcripts';
import { TextChannel } from 'discord.js';

async function test(channel: TextChannel) {
  const buf = await discordTranscripts.createTranscript(channel, {
    returnType: 'buffer',
  });
  console.log(buf.length);
}
