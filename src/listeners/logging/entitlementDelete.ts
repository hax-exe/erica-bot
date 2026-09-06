import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { type Entitlement, EntitlementType, Events, userMention } from 'discord.js';
import { Colors, logContainer } from '../../lib/components.js';
import { formatUser, sendLog } from '../../lib/LoggingUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'entitlementDeleteLogging',
	event: Events.EntitlementDelete,
})
export class EntitlementDeleteListener extends Listener<typeof Events.EntitlementDelete> {
	public override async run(entitlement: Entitlement) {
		const guildId = entitlement.guildId;
		if (!guildId) return;
		const guild = entitlement.client.guilds.cache.get(guildId);
		if (!guild) return;
		if (!(await isModuleEnabled(guild.id, 'logging'))) return;

		const typeLabel = EntitlementType[entitlement.type] ?? String(entitlement.type);

		await sendLog(
			guild,
			logContainer({
				title: 'App Entitlement Deleted',
				color: Colors.Error,
				fields: [
					...(entitlement.userId ? [{ name: 'User', value: `${formatUser(entitlement.userId)}` }] : []),
					{ name: 'Type', value: typeLabel },
					{ name: 'SKU', value: `\`${entitlement.skuId}\`` },
				],
				timestamp: true,
			}),
		).catch(() => null);
	}
}
