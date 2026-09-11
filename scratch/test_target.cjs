const fs = require('fs');
const content = fs.readFileSync('Plant_Arena_Whitepaper_v2.html', 'utf8');
const target = 'alt="Plant Arena Lands & Farming" style="width:100%;max-height:440px;object-fit:cover;border-radius:20px;border:2px solid #3d794e;box-shadow:0 16px 40px rgba(0,0,0,.7)">';
const count = content.split(target).length - 1;
console.log('Occurrences of target:', count);
