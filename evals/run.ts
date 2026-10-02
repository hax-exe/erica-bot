import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIELDS = ['id', 'source', 'prompt', 'acceptance', 'check'] as const;
type Field = (typeof FIELDS)[number];
type Case = Record<Field, string>;

const root = join(import.meta.dir, '..');
const casesDir = join(import.meta.dir, 'cases');
const only = process.argv[2];

function validate(file: string): { c?: Case; errors: string[] } {
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(join(casesDir, file), 'utf8'));
	} catch (e) {
		return { errors: [`invalid JSON: ${(e as Error).message}`] };
	}
	if (!raw || typeof raw !== 'object') return { errors: ['not an object'] };
	const errors: string[] = [];
	for (const f of FIELDS) {
		const v = (raw as Record<string, unknown>)[f];
		if (typeof v !== 'string' || !v.trim()) errors.push(`missing or empty "${f}"`);
	}
	const id = (raw as Record<string, unknown>).id;
	if (typeof id === 'string' && `${id}.json` !== file) errors.push(`id "${id}" does not match filename`);
	return errors.length ? { errors } : { c: raw as Case, errors };
}

let failed = 0;
const files = readdirSync(casesDir).filter((f) => f.endsWith('.json'));
if (!files.length) {
	console.error('no cases found');
	process.exit(1);
}

for (const file of files) {
	const { c, errors } = validate(file);
	if (!c) {
		failed++;
		console.log(`FAIL ${file}: ${errors.join('; ')}`);
		continue;
	}
	if (only && c.id !== only) continue;
	const res = Bun.spawnSync(['sh', '-c', c.check], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
	if (res.exitCode === 0) console.log(`PASS ${c.id}`);
	else {
		failed++;
		console.log(`FAIL ${c.id} (exit ${res.exitCode}): ${c.check}`);
	}
}

console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
