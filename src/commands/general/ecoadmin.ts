import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { errorReply, successReply } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';
import {
	CURRENCY,
	ecoGuard,
	fmtCoins,
	getOrCreateEconomy,
	logTx,
	MAX_WALLET_BALANCE,
	walletAdd,
	walletDeduct,
} from '../../lib/EconomyUtil.js';

/**
 * Staff economy tools. Split out of `/economy` so the whole command can carry a
 * ManageGuild default permission (subcommand groups can't be permission-gated).
 * The runtime ManageGuild check stays as defence in depth — server admins can
 * override command visibility in Integrations settings.
 */
@ApplyOptions<Subcommand.Options>({
	name: 'ecoadmin',
	description: 'Manage server economy balances (Staff only).',
	subcommands: [
		{ name: 'give', chatInputRun: 'runGive' },
		{ name: 'take', chatInputRun: 'runTake' },
		{ name: 'reset', chatInputRun: 'runReset' },
	],
})
export class EcoAdminCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('ecoadmin')
				.setDescription('Manage server economy balances (Staff only).')
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
				.addSubcommand((s) =>
					s
						.setName('give')
						.setDescription('Give coins to a user.')
						.addUserOption((o) => o.setName('user').setDescription('The user to give coins to.').setRequired(true))
						.addIntegerOption((o) =>
							o
								.setName('amount')
								.setDescription('Amount of coins.')
								.setRequired(true)
								.setMinValue(1)
								.setMaxValue(MAX_WALLET_BALANCE),
						),
				)
				.addSubcommand((s) =>
					s
						.setName('take')
						.setDescription('Take coins from a user.')
						.addUserOption((o) => o.setName('user').setDescription('The user to take coins from.').setRequired(true))
						.addIntegerOption((o) =>
							o.setName('amount').setDescription('Amount of coins.').setRequired(true).setMinValue(1),
						),
				)
				.addSubcommand((s) =>
					s
						.setName('reset')
						.setDescription("Reset a user's wallet, bank, and streak.")
						.addUserOption((o) => o.setName('user').setDescription('The user to reset.').setRequired(true)),
				),
		);
	}

	/** Deferred + module enabled + ManageGuild. */
	private async guard(interaction: Subcommand.ChatInputCommandInteraction): Promise<boolean> {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!(await ecoGuard(interaction))) return false;
		if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
			await interaction.editReply(errorReply('You do not have permission to manage the server economy.'));
			return false;
		}
		return true;
	}

	// ── /ecoadmin give ─────────────────────────────────────────────────────────
	public async runGive(interaction: Subcommand.ChatInputCommandInteraction) {
		if (!(await this.guard(interaction))) return;

		const target = interaction.options.getUser('user', true);
		const amount = interaction.options.getInteger('amount', true);
		if (target.bot) return interaction.editReply(errorReply('Cannot give coins to a bot.'));

		const before = await getOrCreateEconomy(target.id, interaction.guild!.id);
		if (amount > MAX_WALLET_BALANCE - before.balance) {
			return interaction.editReply(
				errorReply(
					`That would push <@${target.id}>'s wallet past the maximum of ${fmtCoins(MAX_WALLET_BALANCE)}. ` +
						`They can receive at most ${fmtCoins(Math.max(0, MAX_WALLET_BALANCE - before.balance))}.`,
				),
			);
		}
		await walletAdd(target.id, interaction.guild!.id, amount);
		await logTx(interaction.guild!.id, target.id, 'admin_add', amount, {
			note: `Given by staff: ${interaction.user.tag}`,
		});

		const row = await getOrCreateEconomy(target.id, interaction.guild!.id);

		return interaction.editReply(
			successReply(
				`Successfully gave ${fmtCoins(amount)} to <@${target.id}>.\n` +
					`-# Target's New Wallet: ${row.balance.toLocaleString()} ${CURRENCY}`,
			),
		);
	}

	// ── /ecoadmin take ─────────────────────────────────────────────────────────
	public async runTake(interaction: Subcommand.ChatInputCommandInteraction) {
		if (!(await this.guard(interaction))) return;

		const target = interaction.options.getUser('user', true);
		const amount = interaction.options.getInteger('amount', true);
		if (target.bot) return interaction.editReply(errorReply('Cannot take coins from a bot.'));

		const row = await getOrCreateEconomy(target.id, interaction.guild!.id);
		const due = Math.min(amount, row.balance);
		// Only count what was actually deducted — the wallet may have changed since it was read.
		const toTake = due > 0 && (await walletDeduct(target.id, interaction.guild!.id, due)) ? due : 0;
		if (toTake > 0) {
			await logTx(interaction.guild!.id, target.id, 'admin_remove', toTake, {
				note: `Taken by staff: ${interaction.user.tag}`,
			});
		}

		const updatedRow = await getOrCreateEconomy(target.id, interaction.guild!.id);

		return interaction.editReply(
			successReply(
				`Successfully took ${fmtCoins(toTake)} from <@${target.id}>'s wallet.\n` +
					`-# Target's New Wallet: ${updatedRow.balance.toLocaleString()} ${CURRENCY}`,
			),
		);
	}

	// ── /ecoadmin reset ────────────────────────────────────────────────────────
	public async runReset(interaction: Subcommand.ChatInputCommandInteraction) {
		if (!(await this.guard(interaction))) return;

		const target = interaction.options.getUser('user', true);
		if (target.bot) return interaction.editReply(errorReply('Cannot reset a bot.'));

		await db
			.update(schema.economy)
			.set({ balance: 0, bank: 0, dailyStreak: 0 })
			.where(and(eq(schema.economy.userId, target.id), eq(schema.economy.guildId, interaction.guild!.id)));

		await logTx(interaction.guild!.id, target.id, 'admin_reset', 0, {
			note: `Reset by staff: ${interaction.user.tag}`,
		});

		return interaction.editReply(
			successReply(`Successfully reset all economy progress (wallet, bank, daily streak) for <@${target.id}>.`),
		);
	}
}
