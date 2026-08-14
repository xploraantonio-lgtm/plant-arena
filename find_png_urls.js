import fs from 'fs';
import path from 'path';

const contentPath = path.join(process.env.USERPROFILE || 'C:\\Users\\familia', '.gemini', 'antigravity', 'brain', 'ce2bf3c3-22cc-4658-8d12-f1edaad60bee', '.system_generated', 'steps', '136', 'content.md');

if (fs.existsSync(contentPath)) {
  const text = fs.readFileSync(contentPath, 'utf8');
  const matches = text.match(/https:\/\/static\.wikia\.nocookie\.net\/plantsvszombies\/images\/[^\s"'>]+\.png/gi) || [];
  const unique = Array.from(new Set(matches));
  console.log('Found Aloe PNGs:', unique.slice(0, 20));
} else {
  console.log('File not found');
}
