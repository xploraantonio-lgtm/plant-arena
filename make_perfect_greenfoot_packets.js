import { Jimp } from 'jimp';
import path from 'path';
import fs from 'fs';

const brainDir = path.join(process.env.USERPROFILE || 'C:\\Users\\familia', '.gemini', 'antigravity', 'brain', 'ce2bf3c3-22cc-4658-8d12-f1edaad60bee');
const greenfootDir = path.join(process.cwd(), 'public', 'game-assets', 'greenfoot');
const plantsDir = path.join(process.cwd(), 'public', 'game-assets', 'plants');

function findLatestJpg(prefix) {
  const files = fs.readdirSync(brainDir).filter(f => f.startsWith(prefix) && f.endsWith('.jpg'));
  if (files.length === 0) return null;
  files.sort((a, b) => fs.statSync(path.join(brainDir, b)).mtimeMs - fs.statSync(path.join(brainDir, a)).mtimeMs);
  return path.join(brainDir, files[0]);
}

async function createAuthenticAsset(jpgPath, baseName) {
  console.log(`Processing ${baseName} from ${jpgPath}...`);
  const raw = await Jimp.read(jpgPath);

  // Remove white background (make background transparent)
  raw.scan(0, 0, raw.width, raw.height, (x, y, idx) => {
    const r = raw.bitmap.data[idx];
    const g = raw.bitmap.data[idx + 1];
    const b = raw.bitmap.data[idx + 2];
    if (r > 235 && g > 235 && b > 235) {
      raw.bitmap.data[idx + 3] = 0; // transparent
    }
  });

  // 1. Save transparent character sprite (e.g. transparentjalapeno.png & jalapeno1.png)
  const spritePath1 = path.join(greenfootDir, `transparent${baseName}.png`);
  const spritePath2 = path.join(greenfootDir, `${baseName}1.png`);
  const spritePath3 = path.join(plantsDir, `${baseName}_sprite.png`);

  await raw.write(spritePath1);
  await raw.write(spritePath2);
  await raw.write(spritePath3);
  console.log(`Saved transparent sprites for ${baseName}`);

  // 2. Build Seed Packet matching peashooterpacket1.png style!
  const packetTemplate = await Jimp.read(path.join(greenfootDir, 'peashooterpacket1.png'));
  const packet = packetTemplate.clone();

  // Resize inner sprite to fit inside wooden frame
  const cardSprite = raw.clone();
  cardSprite.resize({ w: Math.floor(packet.width * 0.7), h: Math.floor(packet.height * 0.7) });

  const xPos = Math.floor((packet.width - cardSprite.width) / 2);
  const yPos = Math.floor((packet.height - cardSprite.height) / 2) + 2;

  packet.composite(cardSprite, xPos, yPos);

  const packetPath1 = path.join(greenfootDir, `${baseName}packet1.png`);
  const packetPath2 = path.join(plantsDir, `${baseName}_icon.png`);

  await packet.write(packetPath1);
  await packet.write(packetPath2);
  console.log(`Saved Greenfoot Seed Packet for ${baseName} -> ${packetPath1}`);
}

async function run() {
  const jal = findLatestJpg('jalapeno_sprite');
  const ice = findLatestJpg('iceberglettuce_sprite');
  const aloe = findLatestJpg('aloe_sprite');

  if (jal) await createAuthenticAsset(jal, 'jalapeno');
  if (ice) await createAuthenticAsset(ice, 'iceberglettuce');
  if (aloe) await createAuthenticAsset(aloe, 'aloe');
}

run().catch(console.error);
