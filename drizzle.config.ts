import 'dotenv/config';
import type { Config } from 'drizzle-kit';

export default {
	schema: './src/db/schema.ts',
	out: './drizzle',
	dialect: 'mysql',
	dbCredentials: {
		url: process.env.DATABASE_URL ?? 'mysql://root:password@localhost:3306/erica',
	},
} satisfies Config;
