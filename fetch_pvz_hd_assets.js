import fs from 'fs';
import path from 'path';
import https from 'https';

const targetDir = path.join(process.cwd(), 'public', 'game-assets', 'greenfoot');

// List of candidate official wiki HD PNG URLs for Jalapeno, Iceberg Lettuce, and Aloe
const candidateUrls = {
  jalapeno: [
    'https://static.wikia.nocookie.net/plantsvszombies/images/6/6d/Jalapeno.png/revision/latest',
    'https://static.wikia.nocookie.net/plantsvszombies/images/e/e0/JalapenoHD.png/revision/latest',
    'https://static.wikia.nocookie.net/plantsvszombies/images/2/23/Jalapeno_almanac_pc.png/revision/latest',
  ],
  iceberglettuce: [
    'https://static.wikia.nocookie.net/plantsvszombies/images/a/a8/IcebergLettuceHD.png/revision/latest',
    'https://static.wikia.nocookie.net/plantsvszombies/images/0/05/Iceberg_Lettuce.png/revision/latest',
    'https://static.wikia.nocookie.net/plantsvszombies/images/7/7f/IcebergLettuce2.png/revision/latest',
  ],
  aloe: [
    'https://static.wikia.nocookie.net/plantsvszombies/images/a/a2/AloeHD.png/revision/latest',
    'https://static.wikia.nocookie.net/plantsvszombies/images/2/22/Aloe_HD.png/revision/latest',
    'https://static.wikia.nocookie.net/plantsvszombies/images/8/87/Aloe_PvZ2.png/revision/latest',
  ],
};

const downloadFile = (url, dest) => {
  return new Promise((resolve) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    };
    https.get(url, options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadFile(res.headers.location, dest).then(resolve);
      }
      if (res.statusCode !== 200) {
        resolve(false);
        return;
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log(`SUCCESS: Saved ${dest} from ${url}`);
        resolve(true);
      });
    }).on('error', () => resolve(false));
  });
};

async function testAll() {
  for (const [key, urls] of Object.entries(candidateUrls)) {
    let success = false;
    for (const u of urls) {
      const dest = path.join(targetDir, `${key}1.png`);
      success = await downloadFile(u, dest);
      if (success) break;
    }
    if (!success) {
      console.log(`Failed all candidates for ${key}`);
    }
  }
}

testAll();
