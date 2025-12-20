import { config } from '../config/index.js';
import { createLogger } from './logger.js';

const logger = createLogger('recommendations');

interface SpotifyTrack {
    id: string;
    name: string;
    artists: Array<{ name: string }>;
    external_urls: { spotify: string };
    duration_ms: number;
}

interface SpotifyRecommendation {
    title: string;
    author: string;
    uri: string;
    source: 'spotify' | 'youtube' | 'soundcloud';
    duration: number;
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
): Promise<SpotifyRecommendation[]> {
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
