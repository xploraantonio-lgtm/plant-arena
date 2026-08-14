import fs from 'fs';
import path from 'path';
import https from 'https';

const plantsDir = path.join(process.cwd(), 'public', 'game-assets', 'plants');
const greenfootDir = path.join(process.cwd(), 'public', 'game-assets', 'greenfoot');

if (!fs.existsSync(plantsDir)) fs.mkdirSync(plantsDir, { recursive: true });
if (!fs.existsSync(greenfootDir)) fs.mkdirSync(greenfootDir, { recursive: true });

// HD image URLs directly from the 3 user-provided Fandom wiki galleries:
const hdImages = {
  // Jalapeno HD Artwork from Jalapeno Gallery
  jalapeno_hd: 'https://static.wikia.nocookie.net/plantsvszombies/images/2/23/Jalapeno_almanac_pc.png/revision/latest',
  
  // Iceberg Lettuce HD Artwork from Iceberg Lettuce Gallery
  iceberg_hd: 'https://static.wikia.nocookie.net/plantsvszombies/images/3/39/Iceberg_Lettuce_Almanac_Entry_1_10.5.2.PNG/revision/latest',
  
  // Aloe HD Artwork from Aloe Gallery
  aloe_hd: 'https://static.wikia.nocookie.net/plantsvszombies/images/0/04/Aloe%27s_Costume_1_HD.png/revision/latest'
};

const download = (url, dests) => {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return download(res.headers.location, dests).then(resolve);
      }
      if (res.statusCode !== 200) {
        console.error(`Failed ${url} status ${res.statusCode}`);
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
    }).on('error', (err) => {
      console.error(err.message);
      resolve(false);
    });
  });
};

async function run() {
  await download(hdImages.jalapeno_hd, [
    path.join(plantsDir, 'jalapeno_hd.png'),
    path.join(greenfootDir, 'jalapeno_hd.png'),
    path.join(greenfootDir, 'jalapenopacket1.png'),
    path.join(plantsDir, 'jalapeno_icon.png'),
    path.join(plantsDir, 'jalapeno_sprite.png')
  ]);

  await download(hdImages.iceberg_hd, [
    path.join(plantsDir, 'iceberglettuce_hd.png'),
    path.join(greenfootDir, 'iceberglettuce_hd.png'),
    path.join(greenfootDir, 'iceberglettucepacket1.png'),
    path.join(plantsDir, 'iceberglettuce_icon.png'),
    path.join(plantsDir, 'iceberglettuce_sprite.png')
  ]);

  await download(hdImages.aloe_hd, [
    path.join(plantsDir, 'aloe_hd.png'),
    path.join(greenfootDir, 'aloe_hd.png'),
    path.join(greenfootDir, 'aloepacket1.png'),
    path.join(plantsDir, 'aloe_icon.png'),
    path.join(plantsDir, 'aloe_sprite.png')
  ]);
}

run();
