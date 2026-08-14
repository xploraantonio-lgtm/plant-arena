import fs from 'fs';
import path from 'path';

const stepsDir = path.join(process.env.USERPROFILE || 'C:\\Users\\familia', '.gemini', 'antigravity', 'brain', 'ce2bf3c3-22cc-4658-8d12-f1edaad60bee', '.system_generated', 'steps');

function getGallery(stepId) {
  const file = path.join(stepsDir, stepId, 'content.md');
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  const matches = Array.from(new Set(text.match(/https:\/\/static\.wikia\.nocookie\.net\/plantsvszombies\/images\/[^\s"'>]+\.(png|jpg|jpeg|gif)/gi) || []));
  return matches;
}

console.log('Jalapeno count:', getGallery('219').length);
console.log('Iceberg count:', getGallery('132').length);
console.log('Aloe count:', getGallery('136').length);
