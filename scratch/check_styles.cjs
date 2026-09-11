const fs = require('fs');
const content = fs.readFileSync('Plant_Arena_Whitepaper_v2.html', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
  if (line.includes('<img') && !line.includes('class="char"') && !line.includes('class="cover-bg"')) {
    const styleMatch = line.match(/style="([^"]+)"/);
    const altMatch = line.match(/alt="([^"]+)"/);
    console.log('Line ' + (idx+1) + ':', altMatch ? altMatch[1] : 'No alt', '| style:', styleMatch ? styleMatch[1] : 'No inline style');
  }
});
