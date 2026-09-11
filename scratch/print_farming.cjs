const fs = require('fs');
const content = fs.readFileSync('Plant_Arena_Whitepaper_v2.html', 'utf8');
const lines = content.split('\n');
let inFarming = false;
lines.forEach((line, idx) => {
  if (line.includes('id="farming"')) inFarming = true;
  if (inFarming) {
    if (line.length > 200) {
      console.log((idx+1) + ': ' + line.substring(0, 150) + ' ... [truncated, total ' + line.length + ']');
    } else {
      console.log((idx+1) + ': ' + line);
    }
  }
  if (inFarming && line.includes('</section>')) inFarming = false;
});
