import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { type Entitlement, EntitlementType, Events, userMention } from 'discord.js';
import { Colors, logContainer } from '../../lib/components.js';
import { formatUser, sendLog } from '../../lib/LoggingUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'entitlementCreateLogging',
	event: Events.EntitlementCreate,
})
export class EntitlementCreateListener extends Listener<typeof Events.EntitlementCreate> {
	public override async run(entitlement: Entitlement) {
		const guildId = entitlement.guildId;
		if (!guildId) return; // User-scoped entitlement — no guild to log to
		const guild = entitlement.client.guilds.cache.get(guildId);
		if (!guild) return;
		if (!(await isModuleEnabled(guild.id, 'logging'))) return;

		const typeLabel = EntitlementType[entitlement.type] ?? String(entitlement.type);

		await sendLog(
			guild,
			logContainer({
				title: 'App Entitlement Created',
				color: Colors.Success,
				fields: [
					...(entitlement.userId ? [{ name: 'User', value: `${formatUser(entitlement.userId)}` }] : []),
					{ name: 'Type', value: typeLabel },
					{ name: 'SKU', value: `\`${entitlement.skuId}\`` },
					...(entitlement.startsAt
						? [{ name: 'Starts', value: `<t:${Math.floor(entitlement.startsAt.getTime() / 1000)}:D>` }]
						: []),
					...(entitlement.endsAt
						? [{ name: 'Ends', value: `<t:${Math.floor(entitlement.endsAt.getTime() / 1000)}:D>` }]
						: []),
				],
				timestamp: true,
			}),
		).catch(() => null);
	}
}
