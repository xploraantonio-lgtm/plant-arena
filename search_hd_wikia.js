import fs from 'fs';
import path from 'path';
import https from 'https';

const targetDir = path.join(process.cwd(), 'public', 'game-assets', 'greenfoot');

const candidates = {
  iceberglettuce: [
    'https://static.wikia.nocookie.net/plantsvszombies/images/c/c5/IcebergLettuce.png/revision/latest',
    'https://static.wikia.nocookie.net/plantsvszombies/images/9/90/Iceberg_Lettuce.png/revision/latest',
    'https://static.wikia.nocookie.net/plantsvszombies/images/b/b2/IcebergLettucePvZ2.png/revision/latest',
    'https://static.wikia.nocookie.net/plantsvszombies/images/3/36/Iceberg_lettuce.png/revision/latest',
    'https://static.wikia.nocookie.net/plantsvszombies/images/1/1b/Iceberg_Lettuce2.png/revision/latest',
  ],
  aloe: [
    'https://static.wikia.nocookie.net/plantsvszombies/images/a/a2/Aloe.png/revision/latest',
    'https://static.wikia.nocookie.net/plantsvszombies/images/e/e4/Aloe.png/revision/latest',
    'https://static.wikia.nocookie.net/plantsvszombies/images/8/8e/Aloe_PvZ2.png/revision/latest',
    'https://static.wikia.nocookie.net/plantsvszombies/images/0/04/Aloe%27s_Costume_1_HD.png/revision/latest',
  ]
};

const checkUrl = (url) => {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return checkUrl(res.headers.location).then(resolve);
      }
      resolve(res.statusCode === 200 ? url : null);
    }).on('error', () => resolve(null));
  });
};

async function find() {
  for (const [name, urls] of Object.entries(candidates)) {
    for (const u of urls) {
      const working = await checkUrl(u);
      if (working) {
        console.log(`FOUND ${name}: ${working}`);
        const file = fs.createWriteStream(path.join(targetDir, `${name}1.png`));
        https.get(working, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => res.pipe(file));
        break;
      }
    }
  }
}

find();
