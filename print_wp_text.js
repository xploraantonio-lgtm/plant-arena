import fs from 'fs';
const content = fs.readFileSync('Plant_Arena_Whitepaper_v2.html', 'utf8');
const lines = content.split('\n');
const out = lines.map((l, idx) => {
  if (l.length > 300 && l.includes('data:image')) {
    return `Line ${idx}: <IMAGE length ${l.length}>`;
  } else {
    return `Line ${idx}: ${l}`;
  }
}).join('\n');
fs.writeFileSync('wp_text.txt', out, 'utf8');
console.log('Saved wp_text.txt utf8');
