import fs from 'fs';
import path from 'path';
import https from 'https';

const plantsDir = path.join(process.cwd(), 'public', 'game-assets', 'plants');
const greenfootDir = path.join(process.cwd(), 'public', 'game-assets', 'greenfoot');

const downloads = [
  {
    url: 'https://static.wikia.nocookie.net/plantsvszombies/images/3/32/Aloe_heal.gif/revision/latest',
    dests: [
      path.join(plantsDir, 'aloe_heal_fx.gif'),
      path.join(greenfootDir, 'aloe_heal_fx.gif')
    ]
  },
  {
    url: 'https://static.wikia.nocookie.net/plantsvszombies/images/f/fd/Aloe_idle.gif/revision/latest',
    dests: [
      path.join(plantsDir, 'aloe_idle.gif'),
      path.join(greenfootDir, 'aloe_idle.gif')
    ]
  },
  {
    url: 'https://static.wikia.nocookie.net/plantsvszombies/images/8/8b/Jalapeno1.png/revision/latest',
    dests: [
      path.join(plantsDir, 'jalapeno_flame_fx.png'),
      path.join(greenfootDir, 'jalapeno_flame_fx.png')
    ]
  }
];

const download = (url, dests) => {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return download(res.headers.location, dests).then(resolve);
      }
      if (res.statusCode !== 200) {
        console.error(`Status ${res.statusCode} for ${url}`);
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

async function main() {
  for (const item of downloads) {
    await download(item.url, item.dests);
  }
}

main();
