import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    PermissionFlagsBits,
    AutocompleteInteraction,
    SharedSlashCommand,
} from 'discord.js';
import type { ExtendedClient } from '../structures/Client.js';

export interface CommandOptions {
    /** Command name and description for slash command */
    data: SharedSlashCommand;

    /** Category for organization */
    category: CommandCategory;

    /** Cooldown in seconds */
    cooldown?: number;

    /** Whether this command is for bot owners only */
    ownerOnly?: boolean;

    /** Whether this command is guild-only (no DMs) */
    guildOnly?: boolean;

    /** Required module to be enabled for this command */
    requiredModule?: 'moderation' | 'music' | 'leveling' | 'economy';

    /** Main command execution */
    execute: (interaction: ChatInputCommandInteraction, client: ExtendedClient) => Promise<void>;

    /** Optional autocomplete handler */
    autocomplete?: (interaction: AutocompleteInteraction, client: ExtendedClient) => Promise<void>;
}

export type CommandCategory =
    | 'moderation'
    | 'music'
    | 'leveling'
    | 'economy'
    | 'fun'
    | 'utility'
    | 'admin'
    | 'giveaway'
    | 'social';

export interface Command extends CommandOptions { }

export class Command implements CommandOptions {
    constructor(options: CommandOptions) {
        Object.assign(this, options);
    }
}

// Permission helpers
export const ModeratorPermissions = [
    PermissionFlagsBits.ModerateMembers,
    PermissionFlagsBits.KickMembers,
    PermissionFlagsBits.BanMembers,
    PermissionFlagsBits.ManageMessages,
];

export const AdminPermissions = [
    PermissionFlagsBits.Administrator,
    PermissionFlagsBits.ManageGuild,
];
