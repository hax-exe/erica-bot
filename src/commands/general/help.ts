import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { MessageFlags, PermissionFlagsBits, TextDisplayBuilder } from 'discord.js';
import { Colors, CV2_FLAG, makeContainer, meta, separator } from '../../lib/components.js';

function isStaff(perms: Readonly<import('discord.js').PermissionsBitField> | null | undefined): boolean {
	if (!perms) return false;
	if (perms.has(PermissionFlagsBits.Administrator)) return true;
	return perms.has(
		PermissionFlagsBits.ManageGuild |
			PermissionFlagsBits.KickMembers |
			PermissionFlagsBits.BanMembers |
			PermissionFlagsBits.ModerateMembers |
			PermissionFlagsBits.ManageMessages,
	);
}

function isOwner(userId: string): boolean {
	return (process.env.BOT_OWNER_IDS ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
		.includes(userId);
}

@ApplyOptions<Command.Options>({
	name: 'help',
	description: 'See what Erica can do — tailored to your role.',
})
export class HelpCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('help')
				.setDescription('See what Erica can do — tailored to your role.')
				.addStringOption((o) =>
					o
						.setName('section')
						.setDescription('Force a help section.')
						.setRequired(false)
						.addChoices(
							{ name: 'Members', value: 'member' },
							{ name: 'Staff', value: 'staff' },
							{ name: 'Admins', value: 'admin' },
							{ name: 'Bot owners', value: 'owner' },
						),
				),
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const forced = interaction.options.getString('section');
		const staff = interaction.inCachedGuild() ? isStaff(interaction.memberPermissions) : false;
		const owner = isOwner(interaction.user.id);

		let section = forced ?? 'member';
		if (!forced) {
			if (owner) section = 'owner';
			else if (staff) section = 'staff';
			else section = 'member';
		}

		// Non-staff can't force admin/owner pages unless they qualify
		if (section === 'owner' && !owner) section = staff ? 'staff' : 'member';
		if ((section === 'staff' || section === 'admin') && !staff && !owner) section = 'member';

		const container = makeContainer({ color: Colors.Info, header: 'Erica Help' });
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(helpBody(section)));
		container.addSeparatorComponents(separator());
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				meta(`Showing: ${section}`, 'Use `/help section:` to switch', 'Modules may be disabled per server'),
			),
		);

		return interaction.reply({
			components: [container],
			flags: (CV2_FLAG | MessageFlags.Ephemeral) as any,
		});
	}
}

function helpBody(section: string): string {
	if (section === 'member') {
		return [
			'**For everyone**',
			'• `/info` — server, user, role, channel, avatar, banner, emoji, invite',
			'• `/level` `/economy` — XP, wallet, earn, shop',
			'• `/gamble` — casino (classic, quick, table, risk, tickets)',
			'• `/play` `/queue` `/skip` — music',
			'• `/fun` — free games, RP, jokes',
			'• `/tools` — timestamps, weather, translate, calc, boosters',
			'• `/snipe` `/quote` — catch deleted messages & quote links',
			'• `/remind` `/afk` `/birthday` `/poll` `/suggest`',
			'• Open a **ticket** from the support panel when you need help',
			'',
			'Tip: create a tag named `faq` — new members get a **Server FAQ** button on welcome.',
		].join('\n');
	}

	if (section === 'staff') {
		return [
			'**Staff tools**',
			'• `/warn` `/timeout` `/kick` `/ban` `/softban` `/purge`',
			'• `/case` — cases, warnings, notes, modstats',
			'• `/mod` — lock, slowmode, roles, announce, mass actions',
			'• `/vc` — voice mute/deafen/move',
			'• `/nuke` `/clone` `/afkchannel` — channel tools',
			'• `/emoji steal` — add custom emojis',
			'• `/ticket` — close, add/remove, stats (includes claims)',
			'• Context menus: Report, View Infractions, Delete & Warn/Timeout/Ban',
		].join('\n');
	}

	if (section === 'admin') {
		return [
			'**Server admins**',
			'• `/module` `/config` — toggles, logs, suggestions, TTS',
			'• `/welcomer` `/automod` `/antiraid` `/status`',
			'• `/leveling` `/starboard` `/counting` `/feeds`',
			'• `/tempvoice` `/sticky` `/autoresponder` `/reactionrole` `/stats`',
			'• `/ticket panel` `/ticket reload` — tickets.yml',
			'• Tag named `faq` powers the welcome FAQ button',
		].join('\n');
	}

	return [
		'**Bot owners** (`/admin`)',
		'• `/admin blacklist` `/admin modules`',
		'• `/admin db` — structured table editor',
		'• `/admin info` `/admin guilds` `/admin leave`',
		'• `/admin say` `/admin dm` `/admin reload` `/admin presence`',
		'• `/admin invite` `/admin lookup` `/admin maintenance`',
		'',
		'Also see `/help section:staff` and `admin` for server tooling.',
	].join('\n');
}
