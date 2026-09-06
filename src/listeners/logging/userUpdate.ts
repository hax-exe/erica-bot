import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type User, userMention } from 'discord.js';
import { Colors, logContainer } from '../../lib/components.js';
import { formatUser, sendLog } from '../../lib/LoggingUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'userUpdateLogging',
	event: Events.UserUpdate,
})
export class UserUpdateListener extends Listener<typeof Events.UserUpdate> {
	public override async run(oldUser: User, newUser: User) {
		const avatarChanged = oldUser.avatar !== newUser.avatar;
		const usernameChanged = oldUser.username !== newUser.username;
		if (!avatarChanged && !usernameChanged) return;

		// Only log in guilds the bot shares with this user and has the member cached
		const guilds = newUser.client.guilds.cache.filter((g) => g.members.cache.has(newUser.id));
		if (guilds.size === 0) return;

		for (const guild of guilds.values()) {
			if (!(await isModuleEnabled(guild.id, 'logging'))) continue;

			if (avatarChanged) {
				const newAvatarUrl = newUser.displayAvatarURL({ size: 256, extension: 'png' });
				const oldAvatarUrl = oldUser.avatar ? oldUser.displayAvatarURL({ size: 256, extension: 'png' }) : null;

				await sendLog(
					guild,
					logContainer({
						title: 'User Avatar Updated',
						color: Colors.Neutral,
						fields: [
							{
								name: 'User',
								value: `${formatUser(newUser.id, newUser.username)}`,
							},
							{ name: 'Old Avatar', value: oldAvatarUrl ? `[View](${oldAvatarUrl})` : '*(none)*' },
							{ name: 'New Avatar', value: `[View](${newAvatarUrl})` },
						],
						thumbnailUrl: newAvatarUrl,
						timestamp: true,
					}),
				).catch(() => null);
			}

			if (usernameChanged) {
				await sendLog(
					guild,
					logContainer({
						title: 'Username Changed',
						color: Colors.Neutral,
						fields: [
							{ name: 'User', value: `${formatUser(newUser.id)}` },
							{ name: 'Old Username', value: oldUser.username },
							{ name: 'New Username', value: newUser.username },
						],
						timestamp: true,
					}),
				).catch(() => null);
			}
		}
	}
}
