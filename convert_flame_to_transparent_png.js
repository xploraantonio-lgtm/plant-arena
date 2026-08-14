import fs from 'fs';
import path from 'path';
import https from 'https';

const plantsDir = path.join(process.cwd(), 'public', 'game-assets', 'plants');
const greenfootDir = path.join(process.cwd(), 'public', 'game-assets', 'greenfoot');

// Official PNG flame wave images from Fandom
const flameUrls = [
  'https://static.wikia.nocookie.net/plantsvszombies/images/8/8b/Jalapeno1.png/revision/latest',
  'https://static.wikia.nocookie.net/plantsvszombies/images/1/17/Jalape%C3%B1o3.png/revision/latest',
  'https://static.wikia.nocookie.net/plantsvszombies/images/4/42/JalapenoAS.png/revision/latest'
];

const download = (url, dests) => {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return download(res.headers.location, dests).then(resolve);
      }
      if (res.statusCode !== 200) return resolve(false);
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        for (const d of dests) {
          fs.writeFileSync(d, buf);
          console.log(`Saved -> ${d}`);
        }
        resolve(true);
      });
    }).on('error', () => resolve(false));
  });
};

async function main() {
  for (const u of flameUrls) {
    const success = await download(u, [
      path.join(plantsDir, 'jalapeno_flame_fx.png'),
      path.join(greenfootDir, 'jalapeno_flame_fx.png')
    ]);
    if (success) break;
  }
}

main();
