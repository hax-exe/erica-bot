// Lavalink audio filter presets - applied via player.shoukaku.setFilters()

export interface FilterPreset {
    name: string;
    description: string;
    filters: {
        equalizer?: Array<{ band: number; gain: number }>;
        timescale?: { speed?: number; pitch?: number; rate?: number };
        tremolo?: { frequency?: number; depth?: number };
        vibrato?: { frequency?: number; depth?: number };
        rotation?: { rotationHz?: number };
        distortion?: {
            sinOffset?: number;
            sinScale?: number;
            cosOffset?: number;
            cosScale?: number;
            tanOffset?: number;
            tanScale?: number;
            offset?: number;
            scale?: number;
        };
        channelMix?: {
            leftToLeft?: number;
            leftToRight?: number;
            rightToLeft?: number;
            rightToRight?: number;
        };
        lowPass?: { smoothing?: number };
        volume?: number;
    };
}

export const FILTER_PRESETS: Record<string, FilterPreset> = {
    none: {
        name: 'None',
        description: 'Remove all filters',
        filters: {},
    },

    bassboost: {
        name: 'Bass Boost',
        description: 'Enhance low frequencies for deeper bass',
        filters: {
            equalizer: [
                { band: 0, gain: 0.25 },
                { band: 1, gain: 0.20 },
                { band: 2, gain: 0.15 },
                { band: 3, gain: 0.10 },
                { band: 4, gain: 0.05 },
            ],
        },
    },

    bassboost_heavy: {
        name: 'Heavy Bass',
        description: 'Maximum bass enhancement',
        filters: {
            equalizer: [
                { band: 0, gain: 0.50 },
                { band: 1, gain: 0.40 },
                { band: 2, gain: 0.30 },
                { band: 3, gain: 0.20 },
                { band: 4, gain: 0.10 },
            ],
        },
    },

    nightcore: {
        name: 'Nightcore',
        description: 'Speed up with higher pitch',
        filters: {
            timescale: {
                speed: 1.25,
                pitch: 1.25,
                rate: 1.0,
            },
        },
    },

    vaporwave: {
        name: 'Vaporwave',
        description: 'Slow down with lower pitch',
        filters: {
            timescale: {
                speed: 0.85,
                pitch: 0.90,
                rate: 1.0,
            },
        },
    },

    '8d': {
        name: '8D Audio',
        description: 'Rotating stereo effect',
        filters: {
            rotation: {
                rotationHz: 0.2,
            },
        },
    },

    karaoke: {
        name: 'Karaoke',
        description: 'Reduce vocals',
        filters: {
            // Karaoke uses specific filter settings
            channelMix: {
                leftToLeft: 1.0,
                leftToRight: 0.5,
                rightToLeft: 0.5,
                rightToRight: 1.0,
            },
        },
    },

    tremolo: {
        name: 'Tremolo',
        description: 'Wavering volume effect',
        filters: {
            tremolo: {
                frequency: 4.0,
                depth: 0.5,
            },
        },
    },

    vibrato: {
        name: 'Vibrato',
        description: 'Wavering pitch effect',
        filters: {
            vibrato: {
                frequency: 4.0,
                depth: 0.5,
            },
        },
    },

    soft: {
        name: 'Soft',
        description: 'Muffled, warm sound',
        filters: {
            lowPass: {
                smoothing: 20.0,
            },
        },
    },

    pop: {
        name: 'Pop',
        description: 'Enhanced mid frequencies for vocals',
        filters: {
            equalizer: [
                { band: 0, gain: -0.1 },
                { band: 1, gain: -0.05 },
                { band: 2, gain: 0.05 },
                { band: 3, gain: 0.15 },
                { band: 4, gain: 0.20 },
                { band: 5, gain: 0.15 },
                { band: 6, gain: 0.10 },
                { band: 7, gain: 0.05 },
                { band: 8, gain: 0.0 },
            ],
        },
    },

    rock: {
        name: 'Rock',
        description: 'Enhanced lows and highs',
        filters: {
            equalizer: [
                { band: 0, gain: 0.20 },
                { band: 1, gain: 0.15 },
                { band: 2, gain: 0.05 },
                { band: 3, gain: -0.05 },
                { band: 4, gain: -0.05 },
                { band: 5, gain: 0.0 },
                { band: 6, gain: 0.10 },
                { band: 7, gain: 0.15 },
                { band: 8, gain: 0.20 },
            ],
        },
    },

    electronic: {
        name: 'Electronic',
        description: 'Perfect for EDM and electronic music',
        filters: {
            equalizer: [
                { band: 0, gain: 0.30 },
                { band: 1, gain: 0.25 },
                { band: 2, gain: 0.10 },
                { band: 3, gain: 0.0 },
                { band: 4, gain: 0.0 },
                { band: 5, gain: 0.05 },
                { band: 6, gain: 0.15 },
                { band: 7, gain: 0.20 },
                { band: 8, gain: 0.25 },
            ],
        },
    },
};

export function getFilterNames(): string[] {
    return Object.keys(FILTER_PRESETS);
}

export function getFilterPreset(name: string): FilterPreset | undefined {
    return FILTER_PRESETS[name.toLowerCase()];
}

export async function applyFilter(
    player: { shoukaku: { setFilters: (filters: FilterPreset['filters']) => Promise<void> } },
    filterName: string
): Promise<boolean> {
    const preset = getFilterPreset(filterName);
    if (!preset) return false;

    await player.shoukaku.setFilters(preset.filters);
    return true;
}
