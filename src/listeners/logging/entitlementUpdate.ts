import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { type Entitlement, EntitlementType, Events, userMention } from 'discord.js';
import { Colors, logContainer } from '../../lib/components.js';
import { formatUser, sendLog } from '../../lib/LoggingUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'entitlementUpdateLogging',
	event: Events.EntitlementUpdate,
})
export class EntitlementUpdateListener extends Listener<typeof Events.EntitlementUpdate> {
	public override async run(_oldEntitlement: Entitlement | null, newEntitlement: Entitlement) {
		const guildId = newEntitlement.guildId;
		if (!guildId) return;
		const guild = newEntitlement.client.guilds.cache.get(guildId);
		if (!guild) return;
		if (!(await isModuleEnabled(guild.id, 'logging'))) return;

		const typeLabel = EntitlementType[newEntitlement.type] ?? String(newEntitlement.type);

		await sendLog(
			guild,
			logContainer({
				title: 'App Entitlement Updated',
				color: Colors.Neutral,
				fields: [
					...(newEntitlement.userId ? [{ name: 'User', value: `${formatUser(newEntitlement.userId)}` }] : []),
					{ name: 'Type', value: typeLabel },
					{ name: 'SKU', value: `\`${newEntitlement.skuId}\`` },
					...(newEntitlement.endsAt
						? [{ name: 'Ends', value: `<t:${Math.floor(newEntitlement.endsAt.getTime() / 1000)}:D>` }]
						: []),
				],
				timestamp: true,
			}),
		).catch(() => null);
	}
}
