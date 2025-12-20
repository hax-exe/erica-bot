import { config } from '../config/index.js';
import { createLogger } from './logger.js';

const logger = createLogger('lyrics');

interface GeniusSong {
    id: number;
    title: string;
    artist_names: string;
    url: string;
    song_art_image_url?: string;
}

interface LyricsResult {
    title: string;
    artist: string;
    lyrics: string;
    url: string;
    thumbnail?: string | undefined;
}

/**
 * Search for a song on Genius
 */
/**
 * Search for a song on Genius
 */
async function searchGeniusSong(query: string, artistName?: string): Promise<GeniusSong | null> {
    const accessToken = config.apis.genius?.accessToken;

    if (!accessToken) {
        logger.debug('Genius access token not configured');
        return null;
    }

    try {
        const encodedQuery = encodeURIComponent(query);
        logger.debug({ query }, 'Searching Genius');

        const response = await fetch(
            `https://api.genius.com/search?q=${encodedQuery}`,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            }
        );

        if (!response.ok) {
            logger.error({ status: response.status }, 'Failed to search Genius');
            return null;
        }

        const data = await response.json() as {
            response?: {
                hits?: Array<{ result: GeniusSong }>;
            };
        };

        const hits = data.response?.hits;
        if (!hits || hits.length === 0) {
            logger.debug('No Genius hits found');
            return null;
        }

        logger.debug({ count: hits.length, firstHit: hits[0]?.result.title }, 'Found Genius hits');

        // Filter out unwanted results
        const validHits = hits.filter(hit => {
            const title = hit.result.title.toLowerCase();
            return !title.includes('(script)') &&
                !title.includes('tracklist') &&
                !title.includes('discography') &&
                !title.includes('liner notes');
        });

        if (validHits.length === 0) {
            logger.debug('No valid hits after filtering');
            return null;
        }

        // If artist name is provided, try to find a match
        if (artistName) {
            const normalizedArtist = artistName.toLowerCase();
            const artistMatch = validHits.find(hit =>
                hit.result.artist_names.toLowerCase().includes(normalizedArtist) ||
                normalizedArtist.includes(hit.result.artist_names.toLowerCase())
            );

            if (artistMatch) {
                logger.debug({ match: artistMatch.result.title }, 'Found matching artist');
                return artistMatch.result;
            }
        }

        // Default to first valid hit
        return validHits[0]!.result;
    } catch (error) {
        logger.error({ error }, 'Error searching Genius');
        return null;
    }
}

/**
 * Scrape lyrics from a Genius song page
 * Note: Genius API doesn't provide lyrics directly, so we scrape the page
 */
async function scrapeLyrics(geniusUrl: string): Promise<string | null> {
    try {
        const response = await fetch(geniusUrl);
        if (!response.ok) return null;

        const html = await response.text();

        // Find all lyrics containers and extract their content properly handling nesting
        const containerMarker = 'data-lyrics-container="true"';
        const allLyrics: string[] = [];

        let searchStart = 0;
        while (true) {
            const containerIndex = html.indexOf(containerMarker, searchStart);
            if (containerIndex === -1) break;

            // Find the opening > of this container
            const openTagEnd = html.indexOf('>', containerIndex);
            if (openTagEnd === -1) break;

            // Now find the matching closing </div> by tracking nesting depth
            let depth = 1;
            let pos = openTagEnd + 1;
            let contentStart = pos;

            while (depth > 0 && pos < html.length) {
                const nextOpenDiv = html.indexOf('<div', pos);
                const nextCloseDiv = html.indexOf('</div>', pos);

                if (nextCloseDiv === -1) break;

                if (nextOpenDiv !== -1 && nextOpenDiv < nextCloseDiv) {
                    // Found an opening div before the next closing div
                    depth++;
                    pos = nextOpenDiv + 4; // Move past '<div'
                } else {
                    // Found a closing div
                    depth--;
                    if (depth === 0) {
                        // This is our matching closing tag
                        const content = html.slice(contentStart, nextCloseDiv);
                        allLyrics.push(content);
                    }
                    pos = nextCloseDiv + 6; // Move past '</div>'
                }
            }

            searchStart = pos;
        }

        logger.debug({ count: allLyrics.length }, 'Found lyrics containers');

        if (allLyrics.length === 0) {
            logger.debug('No lyrics containers found');
            return null;
        }

        // Log preview of each chunk for debugging
        allLyrics.forEach((chunk, i) => {
            logger.debug({
                index: i,
                length: chunk.length,
                preview: chunk.slice(0, 80).replace(/\n/g, ' ')
            }, 'Lyrics chunk');
        });

        const rawLyrics = allLyrics.join('\n');
        return cleanLyricsHtml(rawLyrics);
    } catch (error) {
        logger.error({ error }, 'Error scraping lyrics');
        return null;
    }
}

/**
 * Clean HTML tags from lyrics text
 */
function cleanLyricsHtml(html: string): string {
    let text = html
        // Replace <br> and <br/> with newlines
        .replace(/<br\s*\/?>/gi, '\n')
        // Remove other HTML tags but keep their content
        .replace(/<[^>]+>/g, '')
        // Decode HTML entities
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        // Remove excessive whitespace
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    // Remove Genius header metadata (contributor count, translations, etc.)
    // Pattern: number + "Contributors" or "ContributorsTranslations" followed by language names until "Lyrics" or first verse marker
    text = text.replace(/^\d+\s*Contributors?.*?(?=\[|$)/is, '');

    // Remove song title + "Lyrics" header if present at start
    text = text.replace(/^[^\[]*?Lyrics\s*/i, '');

    // Clean up any leading whitespace/newlines after removal
    return text.trim();
}

/**
 * Clean song title by removing metadata like (Official Video), lyrics, etc.
 */
function removeSongMetadata(title: string): string {
    return title
        .replace(/(\(|\[)?(official)?\s?(music)?\s?(video|lyric(s)?|audio)(\)|\])?/gi, '') // Remove (Official Video), [Lyrics], etc.
        .replace(/(\(|\[)?(ft\.|feat\.?)\s+.+?(\)|\])/gi, '') // Remove (ft. Artist)
        .replace(/- topic/gi, '') // Remove "- Topic" from auto-generated videos
        .replace(/\s{2,}/g, ' ') // Collapse multiple spaces
        .trim();
}

/**
 * Clean artist name by removing suffixes like - Topic, VEVO, etc.
 */
function cleanArtistName(artist: string): string {
    return artist
        .replace(/- topic/gi, '')
        .replace(/\svevo/gi, '')
        .replace(/official\schannel/gi, '')
        .trim();
}

/**
 * Get lyrics for a song
 */
export async function getLyrics(
    title: string,
    artist?: string
): Promise<LyricsResult | null> {
    // Build search query with cleaned title and artist for better accuracy
    const cleanedTitle = removeSongMetadata(title);
    const cleanedArtist = artist ? cleanArtistName(artist) : undefined;

    // If artist is provided, use it. If not, try to search just by title (or original title if cleaning emptied it)
    const effectiveTitle = cleanedTitle || title;
    // Use cleaned artist name if available, otherwise fallback to original if cleaning emptied it (unlikely but safe)
    const effectiveArtist = cleanedArtist || artist;

    const query = effectiveArtist ? `${effectiveTitle} ${effectiveArtist}` : effectiveTitle;

    logger.debug({
        originalTitle: title,
        cleanedTitle,
        originalArtist: artist,
        cleanedArtist,
        finalQuery: query
    }, 'Constructing lyrics search query');

    // Search for the song on Genius using cleaned artist for filtering
    const song = await searchGeniusSong(query, effectiveArtist);
    if (!song) {
        return null;
    }

    // Scrape the lyrics from the song page
    const lyrics = await scrapeLyrics(song.url);
    if (!lyrics) {
        return null;
    }

    return {
        title: song.title,
        artist: song.artist_names,
        lyrics,
        url: song.url,
        thumbnail: song.song_art_image_url,
    };
}

/**
 * Split lyrics into chunks for Discord embeds (max 4096 chars per embed)
 */
export function splitLyricsForEmbed(lyrics: string, maxLength = 4000): string[] {
    if (lyrics.length <= maxLength) {
        return [lyrics];
    }

    const chunks: string[] = [];
    let currentChunk = '';

    // Split by paragraphs (double newlines) to avoid cutting mid-verse
    const paragraphs = lyrics.split('\n\n');

    for (const paragraph of paragraphs) {
        if (currentChunk.length + paragraph.length + 2 > maxLength) {
            if (currentChunk) {
                chunks.push(currentChunk.trim());
            }
            // If a single paragraph is too long, split it by lines
            if (paragraph.length > maxLength) {
                const lines = paragraph.split('\n');
                currentChunk = '';
                for (const line of lines) {
                    if (currentChunk.length + line.length + 1 > maxLength) {
                        chunks.push(currentChunk.trim());
                        currentChunk = line;
                    } else {
                        currentChunk += (currentChunk ? '\n' : '') + line;
                    }
                }
            } else {
                currentChunk = paragraph;
            }
        } else {
            currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
        }
    }

    if (currentChunk) {
        chunks.push(currentChunk.trim());
    }

    return chunks;
}

/**
 * Check if Genius API is configured
 */
export function isLyricsConfigured(): boolean {
    return !!config.apis.genius?.accessToken;
}
