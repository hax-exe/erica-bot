import { config } from '../config/index.js';
import { createLogger } from './logger.js';
import type { Kazagumo } from 'kazagumo';

const logger = createLogger('recommendations');

interface SpotifyTrack {
    id: string;
    name: string;
    artists: Array<{ name: string }>;
    external_urls: { spotify: string };
    duration_ms: number;
}

interface Recommendation {
    title: string;
    author: string;
    uri: string;
    source: 'spotify' | 'youtube' | 'soundcloud';
    duration?: number;
}

let accessToken: string | null = null;
let tokenExpiry: number = 0;

/**
 * Get Spotify access token using client credentials flow
 */
async function getSpotifyAccessToken(): Promise<string | null> {
    const { clientId, clientSecret } = config.apis.spotify;

    if (!clientId || !clientSecret) {
        logger.debug('Spotify credentials not configured');
        return null;
    }

    // Return cached token if still valid
    if (accessToken && Date.now() < tokenExpiry) {
        return accessToken;
    }

    try {
        const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
            },
            body: 'grant_type=client_credentials',
        });

        if (!response.ok) {
            logger.error({ status: response.status }, 'Failed to get Spotify access token');
            return null;
        }

        const data = await response.json() as { access_token: string; expires_in: number };
        accessToken = data.access_token;
        tokenExpiry = Date.now() + (data.expires_in - 60) * 1000; // Refresh 1 minute early

        return accessToken;
    } catch (error) {
        logger.error({ error }, 'Error getting Spotify access token');
        return null;
    }
}

/**
 * Extract Spotify track ID from a URI or URL
 */
export function extractSpotifyTrackId(uri: string): string | null {
    // spotify:track:XXXXX format
    const spotifyUriMatch = uri.match(/spotify:track:([a-zA-Z0-9]+)/);
    if (spotifyUriMatch?.[1]) return spotifyUriMatch[1];

    // https://open.spotify.com/track/XXXXX format
    const spotifyUrlMatch = uri.match(/open\.spotify\.com\/track\/([a-zA-Z0-9]+)/);
    if (spotifyUrlMatch?.[1]) return spotifyUrlMatch[1];

    return null;
}

/**
 * Check if a URI is from YouTube
 */
export function isYouTubeUri(uri: string): boolean {
    return uri.includes('youtube.com') || uri.includes('youtu.be');
}

/**
 * Search Spotify for a track to get its ID
 */
async function searchSpotifyTrack(title: string, artist: string): Promise<string | null> {
    const token = await getSpotifyAccessToken();
    if (!token) return null;

    try {
        const query = encodeURIComponent(`track:${title} artist:${artist}`);
        const response = await fetch(`https://api.spotify.com/v1/search?q=${query}&type=track&limit=1`, {
            headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) return null;

        const data = await response.json() as { tracks?: { items: SpotifyTrack[] } };
        return data.tracks?.items[0]?.id || null;
    } catch (error) {
        logger.error({ error }, 'Error searching Spotify track');
        return null;
    }
}

/**
 * Get track recommendations from Spotify based on a seed track
 */
export async function getSpotifyRecommendations(
    trackUri: string,
    trackTitle?: string,
    trackArtist?: string,
    limit = 5
): Promise<Recommendation[]> {
    const token = await getSpotifyAccessToken();
    if (!token) {
        logger.debug('No Spotify token available for recommendations');
        return [];
    }

    logger.debug({ trackUri, trackTitle, trackArtist }, 'Getting recommendations for track');

    // Try to extract track ID from URI
    let trackId = extractSpotifyTrackId(trackUri);

    // If not a Spotify track, search for it
    if (!trackId && trackTitle && trackArtist) {
        logger.debug('Not a Spotify URI, searching for track...');
        trackId = await searchSpotifyTrack(trackTitle, trackArtist);
    }

    if (!trackId) {
        logger.debug({ trackUri, trackTitle, trackArtist }, 'Could not determine Spotify track ID for recommendations');
        return [];
    }

    logger.debug({ trackId }, 'Found Spotify track ID, fetching recommendations');

    try {
        const response = await fetch(
            `https://api.spotify.com/v1/recommendations?seed_tracks=${trackId}&limit=${limit}`,
            { headers: { Authorization: `Bearer ${token}` } }
        );

        if (response.ok) {
            const data = await response.json() as { tracks: SpotifyTrack[] };
            logger.debug({ count: data.tracks.length }, 'Got recommendations from Spotify');

            return data.tracks.map((track) => ({
                title: track.name,
                author: track.artists.map((a) => a.name).join(', '),
                uri: track.external_urls.spotify,
                source: 'spotify' as const,
                duration: track.duration_ms,
            }));
        }

        // Recommendations API deprecated for new apps (Nov 2024)
        // Fallback: Get artist's other top tracks
        logger.debug({ status: response.status }, 'Recommendations API unavailable, trying artist top tracks fallback');

        // Get the original track info to find the artist
        const trackResponse = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
            headers: { Authorization: `Bearer ${token}` },
        });

        if (!trackResponse.ok) {
            logger.debug('Could not fetch track details for fallback');
            return [];
        }

        const trackData = await trackResponse.json() as SpotifyTrack & { artists: Array<{ id: string; name: string }> };
        const artistId = trackData.artists[0]?.id;

        if (!artistId) {
            logger.debug('No artist ID found for fallback');
            return [];
        }

        // Get artist's top tracks
        const topTracksResponse = await fetch(
            `https://api.spotify.com/v1/artists/${artistId}/top-tracks?market=US`,
            { headers: { Authorization: `Bearer ${token}` } }
        );

        if (!topTracksResponse.ok) {
            logger.debug({ status: topTracksResponse.status }, 'Failed to get artist top tracks');
            return [];
        }

        const topTracksData = await topTracksResponse.json() as { tracks: SpotifyTrack[] };

        // Filter out the current track and take up to `limit` tracks
        const filteredTracks = topTracksData.tracks
            .filter((t) => t.id !== trackId)
            .slice(0, limit);

        logger.debug({ count: filteredTracks.length }, 'Got suggestions from artist top tracks');

        return filteredTracks.map((track) => ({
            title: track.name,
            author: track.artists.map((a) => a.name).join(', '),
            uri: track.external_urls.spotify,
            source: 'spotify' as const,
            duration: track.duration_ms,
        }));
    } catch (error) {
        logger.error({ error }, 'Error getting Spotify recommendations');
        return [];
    }
}

/**
 * Get YouTube recommendations using Lavalink search
 * This searches for related songs based on the current track's title and artist
 */
export async function getYouTubeRecommendations(
    music: Kazagumo,
    trackTitle: string,
    trackArtist: string,
    currentUri: string,
    limit = 5
): Promise<Recommendation[]> {
    try {
        // Clean up the title - remove common suffixes like "(Official Video)", "[HD]", etc.
        const cleanTitle = trackTitle
            .replace(/\(official\s*(music\s*)?video\)/gi, '')
            .replace(/\(official\s*audio\)/gi, '')
            .replace(/\(lyrics?\)/gi, '')
            .replace(/\[.*?\]/g, '')
            .replace(/\(.*?remix.*?\)/gi, '')
            .trim();

        // Search for related songs by the same artist
        const searchQuery = `${trackArtist} songs`;
        logger.debug({ searchQuery }, 'Searching YouTube for recommendations');

        const result = await music.search(searchQuery, { requester: null, engine: 'ytsearch:' });

        if (!result.tracks.length) {
            // Try a more generic search
            const fallbackQuery = `${cleanTitle} ${trackArtist}`;
            logger.debug({ fallbackQuery }, 'First search failed, trying fallback');
            const fallbackResult = await music.search(fallbackQuery, { requester: null, engine: 'ytsearch:' });

            if (!fallbackResult.tracks.length) {
                logger.debug('No YouTube results found for recommendations');
                return [];
            }

            result.tracks = fallbackResult.tracks;
        }

        // Filter out the current track and shorts, take up to limit
        const recommendations = result.tracks
            .filter((track) => {
                // Skip the current track
                if (track.uri === currentUri) return false;
                // Skip tracks with same title (likely the same song)
                if (track.title.toLowerCase().includes(cleanTitle.toLowerCase())) return false;
                // Skip shorts (usually under 60 seconds)
                if (track.length && track.length < 60000) return false;
                // Skip if title contains "shorts" or "#shorts"
                if (track.title.toLowerCase().includes('short')) return false;
                return true;
            })
            .slice(0, limit)
            .map((track) => ({
                title: track.title,
                author: track.author || 'Unknown',
                uri: track.uri || '',
                source: 'youtube' as const,
                duration: track.length || 0,
            }));

        logger.debug({ count: recommendations.length }, 'Got YouTube recommendations');
        return recommendations;
    } catch (error) {
        logger.error({ error }, 'Error getting YouTube recommendations');
        return [];
    }
}

/**
 * Get recommendations for a track, trying Spotify first then YouTube as fallback
 */
export async function getRecommendations(
    music: Kazagumo,
    trackUri: string,
    trackTitle: string,
    trackArtist: string,
    limit = 5
): Promise<Recommendation[]> {
    // Always try Spotify first (has better music metadata)
    const spotifyRecs = await getSpotifyRecommendations(trackUri, trackTitle, trackArtist, limit);

    if (spotifyRecs.length > 0) {
        logger.debug({ count: spotifyRecs.length }, 'Using Spotify recommendations');
        return spotifyRecs;
    }

    // Fallback to YouTube if Spotify didn't work
    logger.debug('Spotify recommendations unavailable, falling back to YouTube');
    const youtubeRecs = await getYouTubeRecommendations(music, trackTitle, trackArtist, trackUri, limit);

    if (youtubeRecs.length > 0) {
        logger.debug({ count: youtubeRecs.length }, 'Using YouTube recommendations');
        return youtubeRecs;
    }

    logger.debug('No recommendations available from any source');
    return [];
}

/**
 * Format a suggestion label with source icon
 */
export function formatSuggestionLabel(
    track: { title: string; author: string },
    source: 'spotify' | 'youtube' | 'soundcloud'
): string {
    const label = `${track.author} - ${track.title}`;
    return label.length > 100 ? label.slice(0, 97) + '...' : label;
}

/**
 * Source emoji map for select menu options
 */
export const SOURCE_EMOJIS = {
    spotify: '🟢',
    youtube: '🔴',
    soundcloud: '🟠',
} as const;

