/**
 * Fetch everyday jokes people can actually understand (no programmer jokes).
 * Primary: icanhazdadjoke.com — Fallback: official-joke-api (general).
 */

export async function fetchJoke(): Promise<string> {
	const dad = await fetchDadJoke();
	if (dad) return dad;

	const official = await fetchOfficialJoke();
	if (official) return official;

	return "Why don't scientists trust atoms? Because they make up everything.";
}

async function fetchDadJoke(): Promise<string | null> {
	try {
		const res = await fetch('https://icanhazdadjoke.com/', {
			headers: {
				Accept: 'application/json',
				'User-Agent': 'Erica Discord Bot (AloraMC)',
			},
			signal: AbortSignal.timeout(4_000),
		});
		if (!res.ok) return null;
		const json = (await res.json()) as { joke?: string };
		const joke = json.joke?.trim();
		return joke || null;
	} catch {
		return null;
	}
}

async function fetchOfficialJoke(): Promise<string | null> {
	try {
		// Avoid Programming type — general / knock-knock / pun only
		const res = await fetch('https://official-joke-api.appspot.com/random_joke', {
			headers: { 'User-Agent': 'Erica Discord Bot (AloraMC)' },
			signal: AbortSignal.timeout(4_000),
		});
		if (!res.ok) return null;
		const json = (await res.json()) as { type?: string; setup?: string; punchline?: string };
		if (json.type === 'programming') return null;
		const setup = json.setup?.trim();
		const punchline = json.punchline?.trim();
		if (!setup || !punchline) return null;
		return `**${setup}**\n${punchline}`;
	} catch {
		return null;
	}
}
