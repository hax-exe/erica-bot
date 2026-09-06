import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { MessageFlags, TextDisplayBuilder, TimestampStyles, time } from 'discord.js';
import {
	Colors,
	cv2Reply,
	errorReply,
	field,
	makeContainer,
	separator,
	successReply,
	warningReply,
} from '../../lib/components.js';

const TS_STYLES = {
	t: TimestampStyles.ShortTime,
	T: TimestampStyles.LongTime,
	d: TimestampStyles.ShortDate,
	D: TimestampStyles.LongDate,
	f: TimestampStyles.ShortDateTime,
	F: TimestampStyles.LongDateTime,
	R: TimestampStyles.RelativeTime,
} as const;

function safeCalculate(expression: string): number {
	const cleaned = expression.replace(/\s+/g, '');
	if (!cleaned) throw new Error('Expression is empty.');
	if (!/^[\d+\-*/().%eE]+$/.test(cleaned)) {
		throw new Error('Only numbers and + - * / % ( ) are allowed.');
	}
	// eslint-disable-next-line no-new-func
	const result = Function(`"use strict"; return (${cleaned})`)() as unknown;
	if (typeof result !== 'number' || !Number.isFinite(result)) {
		throw new Error('Expression did not evaluate to a finite number.');
	}
	return result;
}

function parseHexColor(input: string): number {
	const raw = input.trim().replace(/^#/, '');
	if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(raw)) {
		throw new Error('Invalid hex color — use `#RGB` or `#RRGGBB`.');
	}
	const full =
		raw.length === 3
			? raw
					.split('')
					.map((c) => c + c)
					.join('')
			: raw;
	return Number.parseInt(full, 16);
}

@ApplyOptions<Subcommand.Options>({
	name: 'tools',
	description: 'Handy utility commands.',
	subcommands: [
		{ name: 'timestamp', chatInputRun: 'chatInputTimestamp' },
		{ name: 'color', chatInputRun: 'chatInputColor' },
		{ name: 'calc', chatInputRun: 'chatInputCalc' },
		{ name: 'base64', chatInputRun: 'chatInputBase64' },
		{ name: 'firstmessage', chatInputRun: 'chatInputFirstMessage' },
		{ name: 'inrole', chatInputRun: 'chatInputInRole' },
		{ name: 'boosters', chatInputRun: 'chatInputBoosters' },
		{ name: 'translate', chatInputRun: 'chatInputTranslate' },
		{ name: 'weather', chatInputRun: 'chatInputWeather' },
	],
})
export class ToolsCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('tools')
				.setDescription('Handy utility commands.')
				.addSubcommand((sub) =>
					sub
						.setName('timestamp')
						.setDescription('Build Discord timestamp markdown.')
						.addStringOption((o) =>
							o
								.setName('when')
								.setDescription('Unix seconds, ISO date, or relative like 1h / 30m / in 2d.')
								.setRequired(true),
						)
						.addStringOption((o) =>
							o
								.setName('style')
								.setDescription('Discord timestamp style.')
								.setRequired(false)
								.addChoices(
									{ name: 'Relative (R)', value: 'R' },
									{ name: 'Short time (t)', value: 't' },
									{ name: 'Long time (T)', value: 'T' },
									{ name: 'Short date (d)', value: 'd' },
									{ name: 'Long date (D)', value: 'D' },
									{ name: 'Short date/time (f)', value: 'f' },
									{ name: 'Long date/time (F)', value: 'F' },
								),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('color')
						.setDescription('Preview a hex color.')
						.addStringOption((o) => o.setName('hex').setDescription('Hex color, e.g. #43b581').setRequired(true)),
				)
				.addSubcommand((sub) =>
					sub
						.setName('calc')
						.setDescription('Evaluate a math expression.')
						.addStringOption((o) => o.setName('expression').setDescription('e.g. (12+8)*3/2').setRequired(true)),
				)
				.addSubcommand((sub) =>
					sub
						.setName('base64')
						.setDescription('Encode or decode Base64.')
						.addStringOption((o) =>
							o
								.setName('mode')
								.setDescription('Encode or decode.')
								.setRequired(true)
								.addChoices({ name: 'Encode', value: 'encode' }, { name: 'Decode', value: 'decode' }),
						)
						.addStringOption((o) => o.setName('text').setDescription('Input text.').setRequired(true)),
				)
				.addSubcommand((sub) =>
					sub
						.setName('firstmessage')
						.setDescription('Jump to the first message in a channel.')
						.addChannelOption((o) =>
							o.setName('channel').setDescription('Channel (defaults to current).').setRequired(false),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('inrole')
						.setDescription('List members with a role.')
						.addRoleOption((o) => o.setName('role').setDescription('Role to list.').setRequired(true)),
				)
				.addSubcommand((sub) => sub.setName('boosters').setDescription('List current server boosters.'))
				.addSubcommand((sub) =>
					sub
						.setName('translate')
						.setDescription('Translate text between languages.')
						.addStringOption((o) => o.setName('text').setDescription('Text to translate.').setRequired(true))
						.addStringOption((o) =>
							o
								.setName('to')
								.setDescription('Target language.')
								.setRequired(true)
								.addChoices(
									{ name: 'English', value: 'en' },
									{ name: 'Spanish', value: 'es' },
									{ name: 'French', value: 'fr' },
									{ name: 'German', value: 'de' },
									{ name: 'Portuguese', value: 'pt' },
									{ name: 'Italian', value: 'it' },
									{ name: 'Dutch', value: 'nl' },
									{ name: 'Polish', value: 'pl' },
									{ name: 'Russian', value: 'ru' },
									{ name: 'Japanese', value: 'ja' },
									{ name: 'Korean', value: 'ko' },
									{ name: 'Chinese', value: 'zh-CN' },
									{ name: 'Arabic', value: 'ar' },
									{ name: 'Turkish', value: 'tr' },
									{ name: 'Hindi', value: 'hi' },
								),
						)
						.addStringOption((o) =>
							o
								.setName('from')
								.setDescription('Source language (auto if omitted).')
								.setRequired(false)
								.addChoices(
									{ name: 'Auto', value: 'auto' },
									{ name: 'English', value: 'en' },
									{ name: 'Spanish', value: 'es' },
									{ name: 'French', value: 'fr' },
									{ name: 'German', value: 'de' },
									{ name: 'Portuguese', value: 'pt' },
									{ name: 'Japanese', value: 'ja' },
									{ name: 'Korean', value: 'ko' },
									{ name: 'Chinese', value: 'zh-CN' },
								),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('weather')
						.setDescription('Current weather for a city (Open-Meteo).')
						.addStringOption((o) =>
							o.setName('city').setDescription('City name, e.g. London or New York').setRequired(true),
						),
				),
		);
	}

	public async chatInputTimestamp(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const when = interaction.options.getString('when', true).trim();
		const styleKey = (interaction.options.getString('style') ?? 'R') as keyof typeof TS_STYLES;
		const style = TS_STYLES[styleKey] ?? TimestampStyles.RelativeTime;

		let seconds: number | null = null;
		if (/^\d{9,13}$/.test(when)) {
			const n = Number(when);
			seconds = n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
		} else {
			const iso = Date.parse(when);
			if (!Number.isNaN(iso)) {
				seconds = Math.floor(iso / 1000);
			} else {
				const rel = when.match(/^(?:in\s+)?(\d+)\s*(s|sec|secs|m|min|mins|h|hr|hrs|d|day|days|w|wk|wks)$/i);
				if (rel) {
					const n = Number(rel[1]);
					const unit = rel[2]!.toLowerCase();
					const mult = unit.startsWith('s')
						? 1
						: unit.startsWith('m')
							? 60
							: unit.startsWith('h')
								? 3600
								: unit.startsWith('d')
									? 86400
									: 604800;
					seconds = Math.floor(Date.now() / 1000) + n * mult;
				}
			}
		}

		if (seconds == null || !Number.isFinite(seconds)) {
			return interaction.editReply(
				errorReply('Could not parse `when`. Use unix seconds, ISO date, or relative like `1h` / `in 2d`.'),
			);
		}

		const markdown = `<t:${seconds}:${styleKey}>`;
		const c = makeContainer({ color: Colors.Info, header: 'Timestamp' });
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				[
					`**Preview** ${time(seconds, style)}`,
					field('Unix', `\`${seconds}\``),
					field('Markdown', `\`${markdown}\``),
				].join('\n'),
			),
		);
		return interaction.editReply(cv2Reply(c, true));
	}

	public async chatInputColor(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		try {
			const value = parseHexColor(interaction.options.getString('hex', true));
			const hex = value.toString(16).padStart(6, '0');
			const r = (value >> 16) & 255;
			const g = (value >> 8) & 255;
			const b = value & 255;

			const c = makeContainer({ color: value, header: `#${hex.toUpperCase()}` });
			c.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					[
						'-# Accent bar shows this color',
						field('Hex', `\`#${hex.toUpperCase()}\``),
						field('RGB', `\`${r}, ${g}, ${b}\``),
						field('Int', `\`${value}\``),
					].join('\n'),
				),
			);
			return interaction.editReply(cv2Reply(c, true));
		} catch (err) {
			return interaction.editReply(errorReply(err instanceof Error ? err.message : 'Invalid color.'));
		}
	}

	public async chatInputCalc(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const expression = interaction.options.getString('expression', true);
		try {
			const result = safeCalculate(expression);
			return interaction.editReply(successReply(`\`${expression}\` = **${result}**`));
		} catch (err) {
			return interaction.editReply(errorReply(err instanceof Error ? err.message : 'Invalid expression.'));
		}
	}

	public async chatInputBase64(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const mode = interaction.options.getString('mode', true);
		const text = interaction.options.getString('text', true);
		try {
			const out =
				mode === 'encode' ? Buffer.from(text, 'utf8').toString('base64') : Buffer.from(text, 'base64').toString('utf8');
			if (!out) return interaction.editReply(errorReply('Result was empty — check your input.'));
			const body = out.length > 1800 ? `${out.slice(0, 1800)}…` : out;
			const c = makeContainer({ color: Colors.Info, header: mode === 'encode' ? 'Base64 encode' : 'Base64 decode' });
			c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`\`\`\`\n${body}\n\`\`\``));
			return interaction.editReply(cv2Reply(c, true));
		} catch {
			return interaction.editReply(errorReply('Failed to decode — input is not valid Base64.'));
		}
	}

	public async chatInputFirstMessage(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const channel =
			interaction.options.getChannel('channel') ??
			interaction.channel ??
			(await interaction.guild.channels.fetch(interaction.channelId).catch(() => null));
		if (!channel || !channel.isTextBased() || channel.isDMBased() || !('messages' in channel)) {
			return interaction.editReply(errorReply('Pick a text channel.'));
		}

		const messages = await channel.messages.fetch({ after: '0', limit: 1 }).catch(() => null);
		const first = messages?.first();
		if (!first) return interaction.editReply(warningReply('No messages found in that channel.'));

		return interaction.editReply(
			successReply(
				`First message in <#${channel.id}> by <@${first.author.id}> — [jump](${first.url})\n${time(Math.floor(first.createdTimestamp / 1000), TimestampStyles.RelativeTime)}`,
			),
		);
	}

	public async chatInputInRole(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const role = interaction.options.getRole('role', true);
		const full = await interaction.guild.roles.fetch(role.id).catch(() => null);
		if (!full) return interaction.editReply(errorReply('Could not resolve that role.'));

		// Prefer cache; fetch all members if role looks empty but guild is manageable
		let members = [...full.members.values()];
		if (members.length === 0 && interaction.guild.memberCount <= 1000) {
			await interaction.guild.members.fetch().catch(() => null);
			const refreshed = await interaction.guild.roles.fetch(role.id).catch(() => null);
			members = refreshed ? [...refreshed.members.values()] : members;
		}

		if (members.length === 0) {
			return interaction.editReply(warningReply(`No cached members have ${role}.`));
		}

		members.sort((a, b) => a.user.username.localeCompare(b.user.username));
		const shown = members.slice(0, 40);
		const lines = shown.map((m, i) => `\`${i + 1}.\` <@${m.id}> (\`${m.user.tag}\`)`);
		const extra = members.length > shown.length ? `\n-# …and ${members.length - shown.length} more` : '';

		const c = makeContainer({ color: full.color || Colors.Info, header: `Members with ${full.name}` });
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Total** ${members.length}${extra}`));
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
		return interaction.editReply(cv2Reply(c, true));
	}

	public async chatInputBoosters(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		await interaction.guild.members.fetch().catch(() => null);
		const boosters = [...interaction.guild.members.cache.values()]
			.filter((m) => m.premiumSinceTimestamp != null)
			.sort((a, b) => (a.premiumSinceTimestamp ?? 0) - (b.premiumSinceTimestamp ?? 0));

		if (boosters.length === 0) {
			return interaction.editReply(warningReply('No boosters found (or members are not cached).'));
		}

		const lines = boosters.slice(0, 40).map((m, i) => {
			const since = m.premiumSinceTimestamp
				? time(Math.floor(m.premiumSinceTimestamp / 1000), TimestampStyles.RelativeTime)
				: '—';
			return `\`${i + 1}.\` <@${m.id}> — since ${since}`;
		});
		const extra = boosters.length > 40 ? `\n-# …and ${boosters.length - 40} more` : '';
		const c = makeContainer({ color: 0xf47fff, header: 'Server boosters' });
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`**Boosts** ${interaction.guild.premiumSubscriptionCount ?? boosters.length} · **Tier** ${interaction.guild.premiumTier}${extra}`,
			),
		);
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
		return interaction.editReply(cv2Reply(c, true));
	}

	public async chatInputTranslate(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const text = interaction.options.getString('text', true).slice(0, 500);
		const to = interaction.options.getString('to', true);
		const from = interaction.options.getString('from') ?? 'auto';
		const langpair = `${from === 'auto' ? 'autodetect' : from}|${to}`;

		try {
			const url = new URL('https://api.mymemory.translated.net/get');
			url.searchParams.set('q', text);
			url.searchParams.set('langpair', langpair);
			const res = await fetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as {
				responseData?: { translatedText?: string };
				responseStatus?: number;
			};
			const translated = data.responseData?.translatedText?.trim();
			if (!translated || data.responseStatus !== 200) {
				return interaction.editReply(errorReply('Translation failed — try again later.'));
			}
			const c = makeContainer({ color: Colors.Info, header: 'Translate' });
			c.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`**${from} → ${to}**\n${translated.slice(0, 1800)}\n\n-# ${text.slice(0, 200)}`,
				),
			);
			return interaction.editReply(cv2Reply(c, true));
		} catch (err) {
			return interaction.editReply(errorReply(err instanceof Error ? err.message : 'Translation failed.'));
		}
	}

	public async chatInputWeather(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const city = interaction.options.getString('city', true).trim();
		try {
			const geoUrl = new URL('https://geocoding-api.open-meteo.com/v1/search');
			geoUrl.searchParams.set('name', city);
			geoUrl.searchParams.set('count', '1');
			const geoRes = await fetch(geoUrl);
			const geo = (await geoRes.json()) as {
				results?: Array<{ name: string; country?: string; latitude: number; longitude: number; timezone?: string }>;
			};
			const place = geo.results?.[0];
			if (!place) return interaction.editReply(warningReply(`No results for \`${city}\`.`));

			const wxUrl = new URL('https://api.open-meteo.com/v1/forecast');
			wxUrl.searchParams.set('latitude', String(place.latitude));
			wxUrl.searchParams.set('longitude', String(place.longitude));
			wxUrl.searchParams.set('current', 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m');
			wxUrl.searchParams.set('temperature_unit', 'celsius');
			wxUrl.searchParams.set('wind_speed_unit', 'kmh');
			const wxRes = await fetch(wxUrl);
			const wx = (await wxRes.json()) as {
				current?: {
					temperature_2m?: number;
					relative_humidity_2m?: number;
					weather_code?: number;
					wind_speed_10m?: number;
				};
			};
			const cur = wx.current;
			if (!cur) return interaction.editReply(errorReply('Weather data unavailable.'));

			const label = weatherCodeLabel(cur.weather_code ?? 0);
			const where = place.country ? `${place.name}, ${place.country}` : place.name;
			const c = makeContainer({ color: Colors.Info, header: `Weather — ${where}` });
			c.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					[
						`**${label}**`,
						field('Temp', `${cur.temperature_2m}°C`),
						field('Humidity', `${cur.relative_humidity_2m}%`),
						field('Wind', `${cur.wind_speed_10m} km/h`),
						'-# Data via Open-Meteo',
					].join('\n'),
				),
			);
			return interaction.editReply(cv2Reply(c, true));
		} catch (err) {
			return interaction.editReply(errorReply(err instanceof Error ? err.message : 'Weather lookup failed.'));
		}
	}
}

function weatherCodeLabel(code: number): string {
	if (code === 0) return 'Clear';
	if (code <= 3) return 'Partly cloudy';
	if (code <= 48) return 'Fog';
	if (code <= 57) return 'Drizzle';
	if (code <= 67) return 'Rain';
	if (code <= 77) return 'Snow';
	if (code <= 82) return 'Showers';
	if (code <= 86) return 'Snow showers';
	if (code <= 99) return 'Thunderstorm';
	return 'Unknown';
}
