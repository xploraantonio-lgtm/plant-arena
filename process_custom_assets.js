import { Jimp } from 'jimp';
import path from 'path';
import fs from 'fs';

const brainDir = path.join(process.env.USERPROFILE || 'C:\\Users\\familia', '.gemini', 'antigravity', 'brain', 'ce2bf3c3-22cc-4658-8d12-f1edaad60bee');
const targetDir = path.join(process.cwd(), 'public', 'game-assets', 'plants');

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

// Find the latest generated image files in brainDir matching prefix
function findLatestFile(prefix) {
  const files = fs.readdirSync(brainDir).filter(f => f.startsWith(prefix) && (f.endsWith('.jpg') || f.endsWith('.png')));
  if (files.length === 0) return null;
  files.sort((a, b) => fs.statSync(path.join(brainDir, b)).mtimeMs - fs.statSync(path.join(brainDir, a)).mtimeMs);
  return path.join(brainDir, files[0]);
}

async function processImage(srcPath, outIconPath, outSpritePath) {
  console.log(`Processing ${srcPath}...`);
  const img = await Jimp.read(srcPath);

  // Remove white background (make transparent)
  img.scan(0, 0, img.width, img.height, (x, y, idx) => {
    const r = img.bitmap.data[idx];
    const g = img.bitmap.data[idx + 1];
    const b = img.bitmap.data[idx + 2];
    if (r > 240 && g > 240 && b > 240) {
      img.bitmap.data[idx + 3] = 0; // transparent
    }
  });

  // Save sprite (original transparent)
  await img.write(outSpritePath);
  console.log(`Saved sprite: ${outSpritePath}`);

  // Save icon (contain resized for icon)
  const iconImg = img.clone().resize({ w: 160, h: 160 });
  await iconImg.write(outIconPath);
  console.log(`Saved icon: ${outIconPath}`);
}

async function run() {
  const jalFile = findLatestFile('jalapeno_sprite');
  const iceFile = findLatestFile('iceberglettuce_sprite');
  const aloeFile = findLatestFile('aloe_sprite');

  if (jalFile) {
    await processImage(
      jalFile,
      path.join(targetDir, 'jalapeno_icon.png'),
      path.join(targetDir, 'jalapeno_sprite.png')
    );
  }
  if (iceFile) {
    await processImage(
      iceFile,
      path.join(targetDir, 'iceberglettuce_icon.png'),
      path.join(targetDir, 'iceberglettuce_sprite.png')
    );
  }
  if (aloeFile) {
    await processImage(
      aloeFile,
      path.join(targetDir, 'aloe_icon.png'),
      path.join(targetDir, 'aloe_sprite.png')
    );
  }
}

run().catch(console.error);
