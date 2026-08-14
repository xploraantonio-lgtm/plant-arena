import { Jimp } from 'jimp';
import path from 'path';

const plantsDir = path.join(process.cwd(), 'public', 'game-assets', 'plants');
const greenfootDir = path.join(process.cwd(), 'public', 'game-assets', 'greenfoot');

const file1 = path.join(plantsDir, 'jalapeno_flame_fx.png');
const file2 = path.join(greenfootDir, 'jalapeno_flame_fx.png');

async function processTransparent() {
  try {
    console.log(`Processing transparency for ${file1}...`);
    const img = await Jimp.read(file1);

    // Remove solid black or solid white background pixels
    img.scan(0, 0, img.width, img.height, (x, y, idx) => {
      const r = img.bitmap.data[idx];
      const g = img.bitmap.data[idx + 1];
      const b = img.bitmap.data[idx + 2];

      // If background is very dark (black background) or very light (white background)
      if ((r < 18 && g < 18 && b < 18) || (r > 240 && g > 240 && b > 240)) {
        img.bitmap.data[idx + 3] = 0; // Alpha transparent
      }
    });

    await img.write(file1);
    await img.write(file2);
    console.log(`Successfully saved transparent flame FX to ${file1} & ${file2}`);
  } catch (e) {
    console.error(`Error making flame transparent:`, e.message);
  }
}

processTransparent();
