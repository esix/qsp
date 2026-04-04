import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { parseQsp } from './qsp-parser.js';

const EXAMPLES_DIR = join(__dirname, '../../../../_examples');

describe('parseQsp', () => {
  const qspFiles = readdirSync(EXAMPLES_DIR).filter(f => f.endsWith('.qsp'));

  it('should find example .qsp files', () => {
    expect(qspFiles.length).toBeGreaterThan(0);
    console.log(`Found ${qspFiles.length} .qsp files`);
  });

  for (const file of qspFiles) {
    it(`should parse ${file}`, () => {
      const data = readFileSync(join(EXAMPLES_DIR, file));
      const game = parseQsp(new Uint8Array(data));

      console.log(`  ${file}: ${game.locations.length} locations, version="${game.version}", old=${game.isOldFormat}`);

      expect(game.locations.length).toBeGreaterThan(0);
      expect(game.version).toBeTruthy();

      // Check each location has a name
      for (const loc of game.locations) {
        expect(loc.name).toBeTruthy();
      }

      // Print first location details
      const first = game.locations[0];
      console.log(`    First location: "${first.name}"`);
      if (first.code) {
        const codePreview = first.code.substring(0, 120).replace(/\n/g, '\\n');
        console.log(`    Code preview: ${codePreview}`);
      }
      if (first.actions.length > 0) {
        console.log(`    Actions: ${first.actions.map(a => a.name).join(', ')}`);
      }
    });
  }
});
