import fs from 'fs';
import path from 'path';
import https from 'https';

const targetDir = path.join(process.cwd(), 'public', 'game-assets', 'plants');
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

const images = {
  'jalapeno_icon.png': 'https://static.wikia.nocookie.net/plantsvszombies/images/2/23/Jalapeno_almanac_pc.png/revision/latest',
  'jalapeno_sprite.png': 'https://static.wikia.nocookie.net/plantsvszombies/images/2/23/Jalapeno_almanac_pc.png/revision/latest',
  'iceberglettuce_icon.png': 'https://static.wikia.nocookie.net/plantsvszombies/images/3/39/Iceberg_Lettuce_Almanac_Entry_1_10.5.2.PNG/revision/latest',
  'iceberglettuce_sprite.png': 'https://static.wikia.nocookie.net/plantsvszombies/images/3/39/Iceberg_Lettuce_Almanac_Entry_1_10.5.2.PNG/revision/latest',
  'aloe_icon.png': 'https://static.wikia.nocookie.net/plantsvszombies/images/0/04/Aloe%27s_Costume_1_HD.png/revision/latest',
  'aloe_sprite.png': 'https://static.wikia.nocookie.net/plantsvszombies/images/0/04/Aloe%27s_Costume_1_HD.png/revision/latest',
};

const downloadFile = (url, dest) => {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    };
    https.get(url, options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        console.error(`Failed ${url}: status ${res.statusCode}`);
        resolve(false);
        return;
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log(`Saved ${dest}`);
        resolve(true);
      });
    }).on('error', (err) => {
      console.error(`Error ${url}:`, err.message);
      resolve(false);
    });
  });
};

async function run() {
  for (const [filename, url] of Object.entries(images)) {
    const dest = path.join(targetDir, filename);
    await downloadFile(url, dest);
  }
}

run();
