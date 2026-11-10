/**
 * Generates `schema.generated.ts` (Zod) from the canonical JSON Schema.
 *
 * The JSON Schema at resources/spec.schema.json is the single source of truth
 * (CLAUDE.md §5). json-schema-to-zod cannot follow `#/$defs` `$ref`s, so we fully
 * dereference the schema first (it has no circular refs) and feed the inlined form.
 *
 * Run via `npm run spec:generate`. The output is committed and CI verifies it is
 * in sync with the schema (`npm run spec:check`).
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import $RefParser from '@apidevtools/json-schema-ref-parser';
import { jsonSchemaToZod } from 'json-schema-to-zod';

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, '../../../resources/spec.schema.json');
const outPath = resolve(here, 'schema.generated.ts');

const raw = JSON.parse(readFileSync(schemaPath, 'utf8'));
const dereferenced = await $RefParser.dereference(raw);

const body = jsonSchemaToZod(dereferenced, {
    name: 'specSchema',
    type: 'Spec',
    module: 'esm',
    depth: 100,
});

const banner = `// AUTO-GENERATED from resources/spec.schema.json — DO NOT EDIT BY HAND.
// Regenerate with: npm run spec:generate
`;

writeFileSync(outPath, banner + body + '\n', 'utf8');
console.log(`wrote ${outPath}`);
