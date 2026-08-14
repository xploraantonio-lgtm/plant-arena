import fs from 'fs';
import path from 'path';
import https from 'https';

const plantsDir = path.join(process.cwd(), 'public', 'game-assets', 'plants');
const greenfootDir = path.join(process.cwd(), 'public', 'game-assets', 'greenfoot');

const burstUrl = 'https://static.wikia.nocookie.net/plantsvszombies/images/8/80/Iceberg_Lettuce_PF.png/revision/latest';

const download = (url, dests) => {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return download(res.headers.location, dests).then(resolve);
      }
      if (res.statusCode !== 200) {
        console.error(`Status ${res.statusCode}`);
        resolve(false);
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        for (const dest of dests) {
          fs.writeFileSync(dest, buf);
          console.log(`Saved -> ${dest}`);
        }
        resolve(true);
      });
    }).on('error', resolve);
  });
};

download(burstUrl, [
  path.join(plantsDir, 'iceberglettuce_burst.png'),
  path.join(greenfootDir, 'iceberglettuce_burst.png')
]);
