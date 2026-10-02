import { describe, expect, test } from 'bun:test';
import { DEFAULT_PRESET, PRESET_BACKGROUNDS, resolvePresetBackground } from './RankCardUtil.js';

describe('resolvePresetBackground', () => {
	test('known preset resolves to its own background', () => {
		expect(resolvePresetBackground('sunset')).toBe(PRESET_BACKGROUNDS.sunset!);
	});
	test('retired minecraft preset falls back to default', () => {
		expect(resolvePresetBackground('minecraft')).toBe(PRESET_BACKGROUNDS[DEFAULT_PRESET]!);
	});
	test('unknown preset falls back to default without throwing', () => {
		expect(resolvePresetBackground('nope')).toBe(PRESET_BACKGROUNDS[DEFAULT_PRESET]!);
	});
	test('default preset is galaxy and exists', () => {
		expect(DEFAULT_PRESET).toBe('galaxy');
		expect(PRESET_BACKGROUNDS[DEFAULT_PRESET]).toBeDefined();
	});
});
