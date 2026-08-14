import fs from 'fs';
import path from 'path';
import https from 'https';

const greenfootDir = path.join(process.cwd(), 'public', 'game-assets', 'greenfoot');
const plantsDir = path.join(process.cwd(), 'public', 'game-assets', 'plants');

if (!fs.existsSync(greenfootDir)) fs.mkdirSync(greenfootDir, { recursive: true });
if (!fs.existsSync(plantsDir)) fs.mkdirSync(plantsDir, { recursive: true });

const downloads = [
  // Jalapeño
  {
    url: 'https://static.wikia.nocookie.net/plantsvszombies/images/6/6d/Jalapeno.png/revision/latest',
    targets: [
      path.join(greenfootDir, 'jalapeno1.png'),
      path.join(greenfootDir, 'transparentjalapeno.png'),
      path.join(plantsDir, 'jalapeno_sprite.png')
    ]
  },
  {
    url: 'https://static.wikia.nocookie.net/plantsvszombies/images/2/23/Jalapeno_almanac_pc.png/revision/latest',
    targets: [
      path.join(greenfootDir, 'jalapenopacket1.png'),
      path.join(plantsDir, 'jalapeno_icon.png')
    ]
  },
  // Iceberg Lettuce
  {
    url: 'https://static.wikia.nocookie.net/plantsvszombies/images/0/0f/HDIcebergLettuce.png/revision/latest',
    targets: [
      path.join(greenfootDir, 'iceberglettuce1.png'),
      path.join(greenfootDir, 'transparenticeberglettuce.png'),
      path.join(plantsDir, 'iceberglettuce_sprite.png')
    ]
  },
  {
    url: 'https://static.wikia.nocookie.net/plantsvszombies/images/1/18/Iceberg_Lettuce_Newer_Seed_Packet.png/revision/latest',
    targets: [
      path.join(greenfootDir, 'iceberglettucepacket1.png'),
      path.join(plantsDir, 'iceberglettuce_icon.png')
    ]
  },
  // Aloe
  {
    url: 'https://static.wikia.nocookie.net/plantsvszombies/images/8/8b/Aloe_HD.png/revision/latest',
    targets: [
      path.join(greenfootDir, 'aloe1.png'),
      path.join(greenfootDir, 'transparentaloe.png'),
      path.join(plantsDir, 'aloe_sprite.png')
    ]
  },
  {
    url: 'https://static.wikia.nocookie.net/plantsvszombies/images/7/73/Aloe_Newer_Premium_Seed_Packet.png/revision/latest',
    targets: [
      path.join(greenfootDir, 'aloepacket1.png'),
      path.join(plantsDir, 'aloe_icon.png')
    ]
  }
];

const fetchFile = (url) => {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchFile(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Status ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
};

async function main() {
  for (const item of downloads) {
    try {
      console.log(`Downloading ${item.url}...`);
      const buf = await fetchFile(item.url);
      for (const target of item.targets) {
        fs.writeFileSync(target, buf);
        console.log(`Saved -> ${target}`);
      }
    } catch (e) {
      console.error(`Error downloading ${item.url}:`, e.message);
    }
  }
}

main();
