import fs from 'fs';
import path from 'path';

const file = path.join(process.env.USERPROFILE || 'C:\\Users\\familia', '.gemini', 'antigravity', 'brain', 'ce2bf3c3-22cc-4658-8d12-f1edaad60bee', '.system_generated', 'steps', '132', 'content.md');

if (fs.existsSync(file)) {
  const content = fs.readFileSync(file, 'utf8');
  const imgRegex = /https:\/\/static\.wikia\.nocookie\.net\/plantsvszombies\/images\/[^\s"'>]+\.(png|jpg|jpeg|gif)/gi;
  const matches = Array.from(new Set(content.match(imgRegex) || []));
  console.log('--- ALL ICEBERG LETTUCE GALLERY IMAGES ---');
  matches.forEach((m, idx) => console.log(`${idx + 1}: ${m}`));
} else {
  console.log('Step 132 file not found');
}
