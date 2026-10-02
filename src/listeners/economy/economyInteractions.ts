import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type Interaction, MessageFlags } from 'discord.js';
import { isBotBlacklisted } from '../../lib/BlacklistUtil.js';
import { requireComponentOwner } from '../../lib/ComponentOwner.js';
import { errorReply } from '../../lib/components.js';
import { isStaleInteractionError } from '../../lib/GameStore.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'economyInteractions',
	event: Events.InteractionCreate,
})
export class EconomyInteractionsListener extends Listener<typeof Events.InteractionCreate> {
	public override async run(interaction: Interaction) {
		if (!interaction.isButton() || !interaction.inCachedGuild()) return;
		if (await isBotBlacklisted(interaction.user.id)) return;

		if (!interaction.customId.startsWith('eco:dash:')) return;

		const [action, ownerId] = interaction.customId.slice('eco:dash:'.length).split(':');
		// Old customIds carried no owner — reject them rather than act for the wrong user.
		if (!(await requireComponentOwner(interaction, ownerId))) return;

		if (!(await isModuleEnabled(interaction.guildId, 'economy'))) {
			await interaction
				.reply({ ...errorReply('Economy module is disabled.') } as any)
				.catch((err) =>
					isStaleInteractionError(err) ? null : this.container.logger.error('[EconomyInteractions]', err),
				);
			return;
		}

		const command = this.container.stores.get('commands').get('economy') as any;
		if (!command) return;

		// We spoof the interaction so it behaves like a ChatInputCommandInteraction for the command handlers.
		const mockedInteraction = new Proxy(interaction, {
			get(target, prop, receiver) {
				if (prop === 'options') {
					return {
						getString(_name: string) {
							return 'all';
						}, // For deposit/withdraw
						getInteger(_name: string) {
							return 100;
						}, // For slots
						getUser(_name: string) {
							return null;
						},
					};
				}
				const value = Reflect.get(target, prop, receiver);
				if (typeof value === 'function') {
					return value.bind(target);
				}
				return value;
			},
		});

		try {
			switch (action) {
				case 'deposit':
					await command.runDeposit(mockedInteraction);
					break;
				case 'withdraw':
					await command.runWithdraw(mockedInteraction);
					break;
				case 'daily':
					await command.runDaily(mockedInteraction);
					break;
				case 'work':
					await command.runWork(mockedInteraction);
					break;
				case 'crime':
					await command.runCrime(mockedInteraction);
					break;
				case 'slots':
					await command.runSlots(mockedInteraction);
					break;
			}
		} catch (err) {
			// Stale / already-acknowledged interactions (10062, 40060, …) — discard silently.
			if (isStaleInteractionError(err)) return;
			this.container.logger.error('[EconomyInteractions]', err);
			if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
				await interaction.reply({ content: 'An error occurred.', flags: MessageFlags.Ephemeral }).catch(() => null);
			}
		}
	}
}
