import fs from 'fs';
import path from 'path';
import https from 'https';

const plantsDir = path.join(process.cwd(), 'public', 'game-assets', 'plants');
const greenfootDir = path.join(process.cwd(), 'public', 'game-assets', 'greenfoot');

const filePages = [
  { name: 'HDIcebergLettuce.png', url: 'https://plantsvszombies.fandom.com/wiki/File:HDIcebergLettuce.png', key: 'iceberglettuce' },
  { name: 'HD_Jalapeno.png', url: 'https://plantsvszombies.fandom.com/wiki/File:HD_Jalapeno.png', key: 'jalapeno' },
  { name: 'Aloe_HD.png', url: 'https://plantsvszombies.fandom.com/wiki/File:Aloe_HD.png', key: 'aloe' }
];

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchHtml(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function downloadBinary(url, dests) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadBinary(res.headers.location, dests).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Status ${res.statusCode} for ${url}`));
      }
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
    }).on('error', reject);
  });
}

async function run() {
  for (const item of filePages) {
    try {
      console.log(`Fetching HTML page for ${item.name}...`);
      const html = await fetchHtml(item.url);
      
      // Regex matching any static.wikia.nocookie.net image URL
      const matches = html.match(/https:\/\/static\.wikia\.nocookie\.net\/plantsvszombies\/images\/[^\s"'>]+\.(png|jpg|jpeg|gif)/gi) || [];
      console.log(`Found ${matches.length} image URLs in page for ${item.name}`);
      
      if (matches.length > 0) {
        // Find best HD asset match (avoiding sitelogo or thumbnails)
        const best = matches.find(m => !m.includes('Site-logo') && !m.includes('site-logo')) || matches[0];
        let imgUrl = best.split('/revision/')[0] + '/revision/latest';
        console.log(`Selected direct HD image for ${item.name}: ${imgUrl}`);

        const plantPath = path.join(plantsDir, `${item.key}_hd_user.png`);
        const greenfootPath = path.join(greenfootDir, `${item.key}_hd_user.png`);
        const iconPath = path.join(plantsDir, `${item.key}_icon.png`);
        const spritePath = path.join(plantsDir, `${item.key}_sprite.png`);
        const greenfootPacket = path.join(greenfootDir, `${item.key}packet1.png`);

        await downloadBinary(imgUrl, [plantPath, greenfootPath, iconPath, spritePath, greenfootPacket]);
      }
    } catch (e) {
      console.error(`Error resolving ${item.name}:`, e.message);
    }
  }
}

run();
