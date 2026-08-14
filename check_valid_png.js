import { Jimp } from 'jimp';
import path from 'path';

async function testJimp() {
  const dir = path.join(process.cwd(), 'public', 'game-assets', 'greenfoot');
  const files = ['transparentpeashooter.png', 'transparentsunflower.png', 'transparentwalnut.png'];
  for (const f of files) {
    try {
      const img = await Jimp.read(path.join(dir, f));
      console.log(`OK: ${f} (${img.width}x${img.height})`);
    } catch (e) {
      console.log(`FAIL: ${f} (${e.message})`);
    }
  }
}

testJimp();
