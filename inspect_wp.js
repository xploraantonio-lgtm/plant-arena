import fs from 'fs';
const content = fs.readFileSync('Plant_Arena_Whitepaper_v2.html', 'utf8');
const lines = content.split('\n');
console.log('Total lines:', lines.length);
lines.forEach((l, idx) => {
  if (l.includes('<section class="page') || l.includes('class="eyebrow"') || l.includes('<h2>') || l.includes('<h1>')) {
    console.log(idx + ': ' + l.trim().substring(0, 100));
  }
});
