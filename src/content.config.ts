import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
	docs: defineCollection({
		loader: docsLoader(),
		schema: docsSchema({
			extend: z.object({
				tags: z.array(z.string()).default([]),
				// ADRs only; see standards/writing-notes.md for the lifecycle.
				status: z.enum(['proposed', 'accepted', 'rejected', 'deprecated', 'superseded']).optional(),
				created: z.coerce.date().optional(),
				modified: z.coerce.date().optional(),
			}),
		}),
	}),
};
