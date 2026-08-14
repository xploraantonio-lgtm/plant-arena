import fs from 'fs';
import path from 'path';
import https from 'https';

const greenfootDir = path.join(process.cwd(), 'public', 'game-assets', 'greenfoot');
const plantsDir = path.join(process.cwd(), 'public', 'game-assets', 'plants');

const targets = {
  iceberg: [
    'https://static.wikia.nocookie.net/plantsvszombies/images/0/0f/HDIcebergLettuce.png/revision/latest',
    'https://static.wikia.nocookie.net/plantsvszombies/images/a/a8/IcebergLettuceHD.png/revision/latest',
  ],
  jalapeno: [
    'https://static.wikia.nocookie.net/plantsvszombies/images/f/f7/HD_Jalapeno.png/revision/latest',
    'https://static.wikia.nocookie.net/plantsvszombies/images/6/6d/Jalapeno.png/revision/latest',
  ],
  aloe: [
    'https://static.wikia.nocookie.net/plantsvszombies/images/8/8b/Aloe_HD.png/revision/latest',
    'https://static.wikia.nocookie.net/plantsvszombies/images/0/04/Aloe%27s_Costume_1_HD.png/revision/latest',
  ]
};

const checkAndDownload = (url, outPath) => {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return checkAndDownload(res.headers.location, outPath).then(resolve);
      }
      if (res.statusCode !== 200) {
        resolve(false);
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        fs.writeFileSync(outPath, Buffer.concat(chunks));
        console.log(`SUCCESS: ${outPath} from ${url}`);
        resolve(true);
      });
    }).on('error', () => resolve(false));
  });
};

async function run() {
  for (const [key, urls] of Object.entries(targets)) {
    let done = false;
    for (const u of urls) {
      const targetPath = path.join(plantsDir, `${key}_user_hd.png`);
      done = await checkAndDownload(u, targetPath);
      if (done) break;
    }
    if (!done) console.log(`Failed for ${key}`);
  }
}

run();
