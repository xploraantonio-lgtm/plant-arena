const fs = require('fs');

const content = fs.readFileSync('Plant_Arena_Whitepaper_v2.html', 'utf8');
const match = content.match(/<img[^>]+alt="Plant Arena Lands & Farming"[^>]*>/);
if (match) {
  console.log('Tag found, length:', match[0].length);
  const src = match[0].match(/src="([^"]+)"/)[1];
  console.log('src starts with:', src.substring(0, 30));
  const base64Data = src.replace(/^data:image\/webp;base64,/, '');
  fs.writeFileSync('scratch/extracted_farming.webp', Buffer.from(base64Data, 'base64'));
  console.log('Saved scratch/extracted_farming.webp');
} else {
  console.log('No match found');
}
