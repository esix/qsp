import { readFileSync } from 'fs';
import { parseQsp } from '../parser/qsp-parser.js';

const data = readFileSync('C:/pro/qsp/_examples/Les1.Coloring.qsp');
const game = parseQsp(new Uint8Array(data));

for (const loc of game.locations) {
  console.log(`\n=== Location: "${loc.name}" ===`);
  if (loc.description) console.log(`Description: ${loc.description.substring(0, 200)}`);
  if (loc.code) console.log(`Code:\n${loc.code}`);
  if (loc.actions.length > 0) {
    for (const act of loc.actions) {
      console.log(`Action: "${act.name}" => ${act.code}`);
    }
  }
}
