import {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import { db } from '../../db/index.js';
import { shopItems, economySettings } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { withTransaction } from '../../db/transactions.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('shop')
        .setDescription('View and buy items from the shop')
        .addSubcommand((subcommand) =>
            subcommand
                .setName('view')
                .setDescription('View available items')
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('buy')
                .setDescription('Buy an item')
                .addIntegerOption((option) =>
                    option
                        .setName('item_id')
                        .setDescription('ID of the item to buy')
                        .setRequired(true)
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('add')
                .setDescription('Add an item to the shop (Admin)')
                .addStringOption((option) =>
                    option
                        .setName('name')
                        .setDescription('Item name')
                        .setRequired(true)
                        .setMaxLength(64)
                )
                .addIntegerOption((option) =>
                    option
                        .setName('price')
                        .setDescription('Item price')
                        .setRequired(true)
                        .setMinValue(1)
                )
                .addStringOption((option) =>
                    option
                        .setName('description')
                        .setDescription('Item description')
                )
                .addRoleOption((option) =>
                    option
                        .setName('role')
                        .setDescription('Role to give when purchased')
                )
                .addIntegerOption((option) =>
                    option
                        .setName('stock')
                        .setDescription('Available stock (leave empty for unlimited)')
                        .setMinValue(1)
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('remove')
                .setDescription('Remove an item from the shop (Admin)')
                .addIntegerOption((option) =>
                    option
                        .setName('item_id')
                        .setDescription('ID of the item to remove')
                        .setRequired(true)
                )
        ),
    category: 'economy',
    cooldown: 5,
    guildOnly: true,
    requiredModule: 'economy',

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'view':
                await handleView(interaction);
                break;
            case 'buy':
                await handleBuy(interaction);
                break;
            case 'add':
                await handleAdd(interaction);
                break;
            case 'remove':
                await handleRemove(interaction);
                break;
        }
    },
});

async function handleView(interaction: any): Promise<void> {
    const guildId = interaction.guildId!;

    const settings = await db.query.economySettings.findFirst({
        where: eq(economySettings.guildId, guildId),
    });
    const currencyName = settings?.currencyName ?? 'coins';
    const currencySymbol = settings?.currencySymbol ?? '🪙';

    const items = await db.query.shopItems.findMany({
        where: and(
            eq(shopItems.guildId, guildId),
            eq(shopItems.enabled, true)
        ),
    });

    if (items.length === 0) {
        await interaction.reply({
            content: '🛒 The shop is empty! Ask an admin to add items.',
            ephemeral: true,
        });
        return;
    }

    const embed = new EmbedBuilder()
        .setColor(0xffd700)
        .setTitle(`${currencySymbol} Server Shop`)
        .setDescription('Use `/shop buy <item_id>` to purchase an item!')
        .setTimestamp();

    for (const item of items.slice(0, 10)) {
        const stockText = item.stock === null ? 'Unlimited' : `${item.stock} left`;
        const roleText = item.roleId ? `\nGrants: <@&${item.roleId}>` : '';

        embed.addFields({
            name: `#${item.id} • ${item.name} - ${item.price.toLocaleString()} ${currencyName}`,
            value: `${item.description || 'No description'}${roleText}\nStock: ${stockText}`,
        });
    }

    if (items.length > 10) {
        embed.setFooter({ text: `Showing 10 of ${items.length} items` });
    }

    await interaction.reply({ embeds: [embed] });
}

async function handleBuy(interaction: any): Promise<void> {
    const itemId = interaction.options.getInteger('item_id', true);
    const guildId = interaction.guildId!;
    const userId = interaction.user.id;

    const settings = await db.query.economySettings.findFirst({
        where: eq(economySettings.guildId, guildId),
    });
    const currencyName = settings?.currencyName ?? 'coins';

    // Get item (pre-check outside transaction for fast rejection)
    const item = await db.query.shopItems.findFirst({
        where: and(
            eq(shopItems.id, itemId),
            eq(shopItems.guildId, guildId),
            eq(shopItems.enabled, true)
        ),
    });

    if (!item) {
        await interaction.reply({
            content: '❌ Item not found.',
            ephemeral: true,
        });
        return;
    }

    // Perform the purchase atomically: deduct balance + decrement stock in one transaction
    const result = await withTransaction(async (client) => {
        // Atomically deduct balance — fails if insufficient funds
        const balanceResult = await client.query(
            `UPDATE guild_members
             SET balance = balance - $1, updated_at = NOW()
             WHERE guild_id = $2 AND user_id = $3
             AND balance >= $1
             RETURNING balance`,
            [item.price, guildId, userId]
        );

        if (balanceResult.rows.length === 0) {
            // Get current balance for the error message
            const currentBalance = await client.query(
                `SELECT balance FROM guild_members WHERE guild_id = $1 AND user_id = $2`,
                [guildId, userId]
            );
            const balance = currentBalance.rows[0]?.balance ?? 0;
            return { success: false as const, error: 'insufficient_funds', balance };
        }

        // Atomically decrement stock if not unlimited — fails if out of stock
        if (item.stock !== null) {
            const stockResult = await client.query(
                `UPDATE shop_items
                 SET stock = stock - 1
                 WHERE id = $1 AND stock > 0
                 RETURNING stock`,
                [itemId]
            );

            if (stockResult.rows.length === 0) {
                // Transaction will roll back, restoring the balance deduction
                throw new Error('OUT_OF_STOCK');
            }
        }

        return {
            success: true as const,
            newBalance: balanceResult.rows[0].balance as number,
        };
    }).catch((error) => {
        if (error instanceof Error && error.message === 'OUT_OF_STOCK') {
            return { success: false as const, error: 'out_of_stock' as const, balance: 0 };
        }
        throw error;
    });

    if (!result.success) {
        if (result.error === 'out_of_stock') {
            await interaction.reply({
                content: '❌ This item is out of stock.',
                ephemeral: true,
            });
        } else {
            await interaction.reply({
                content: `❌ You don't have enough ${currencyName}. You need ${item.price.toLocaleString()} but have ${result.balance.toLocaleString()}.`,
                ephemeral: true,
            });
        }
        return;
    }

    // Give role if applicable (outside transaction — non-critical side effect)
    if (item.roleId) {
        try {
            const member = await interaction.guild!.members.fetch(userId);
            await member.roles.add(item.roleId);
        } catch {
            // role missing or bot lacks permission - non-fatal
        }
    }

    const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('🛒 Purchase Successful!')
        .setDescription(`You bought **${item.name}** for **${item.price.toLocaleString()}** ${currencyName}!`)
        .addFields({
            name: 'New Balance',
            value: `${result.newBalance.toLocaleString()} ${currencyName}`,
        })
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

async function handleAdd(interaction: any): Promise<void> {
    // Check admin permission
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({
            content: '❌ You need Administrator permission to add shop items.',
            ephemeral: true,
        });
        return;
    }

    const name = interaction.options.getString('name', true);
    const price = interaction.options.getInteger('price', true);
    const description = interaction.options.getString('description');
    const role = interaction.options.getRole('role');
    const stock = interaction.options.getInteger('stock');

    const [newItem] = await db.insert(shopItems)
        .values({
            guildId: interaction.guildId!,
            name,
            price,
            description,
            roleId: role?.id,
            stock,
            enabled: true,
        })
        .returning();

    const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('✅ Item Added')
        .addFields(
            { name: 'ID', value: `${newItem!.id}`, inline: true },
            { name: 'Name', value: name, inline: true },
            { name: 'Price', value: `${price.toLocaleString()}`, inline: true },
        )
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

async function handleRemove(interaction: any): Promise<void> {
    // Check admin permission
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({
            content: '❌ You need Administrator permission to remove shop items.',
            ephemeral: true,
        });
        return;
    }

    const itemId = interaction.options.getInteger('item_id', true);

    const deleted = await db.delete(shopItems)
        .where(and(
            eq(shopItems.id, itemId),
            eq(shopItems.guildId, interaction.guildId!)
        ))
        .returning();

    if (deleted.length === 0) {
        await interaction.reply({
            content: '❌ Item not found.',
            ephemeral: true,
        });
        return;
    }

    await interaction.reply({
        content: `✅ Removed item #${itemId} from the shop.`,
        ephemeral: true,
    });
}
