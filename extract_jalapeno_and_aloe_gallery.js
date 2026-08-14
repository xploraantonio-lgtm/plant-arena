import fs from 'fs';
import path from 'path';

const stepsDir = path.join(process.env.USERPROFILE || 'C:\\Users\\familia', '.gemini', 'antigravity', 'brain', 'ce2bf3c3-22cc-4658-8d12-f1edaad60bee', '.system_generated', 'steps');

function extract(stepId, name) {
  const file = path.join(stepsDir, stepId, 'content.md');
  if (fs.existsSync(file)) {
    const text = fs.readFileSync(file, 'utf8');
    const matches = Array.from(new Set(text.match(/https:\/\/static\.wikia\.nocookie\.net\/plantsvszombies\/images\/[^\s"'>]+\.(png|jpg|jpeg|gif)/gi) || []));
    console.log(`=== ${name} IMAGES (${matches.length}) ===`);
    matches.forEach((m, idx) => console.log(`${idx + 1}: ${m}`));
  } else {
    console.log(`Step ${stepId} not found`);
  }
}

extract('219', 'JALAPENO GALLERY');
extract('136', 'ALOE GALLERY');
