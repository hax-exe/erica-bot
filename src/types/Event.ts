import { ClientEvents } from 'discord.js';
import type { ExtendedClient } from '../structures/Client.js';

export interface EventOptions<K extends keyof ClientEvents> {
    /** Event name */
    name: K;

    /** Whether to run once or on every emission */
    once?: boolean;

    /** Event handler function */
    execute: (client: ExtendedClient, ...args: ClientEvents[K]) => Promise<void> | void;
}

export class Event<K extends keyof ClientEvents> implements EventOptions<K> {
    name: K;
    once: boolean;
    execute: (client: ExtendedClient, ...args: ClientEvents[K]) => Promise<void> | void;

    constructor(options: EventOptions<K>) {
        this.name = options.name;
        this.once = options.once ?? false;
        this.execute = options.execute;
    }
}
