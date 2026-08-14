import { Jimp } from 'jimp';
import path from 'path';

async function check() {
  const base = path.join(process.cwd(), 'public', 'game-assets', 'greenfoot');
  const files = ['peashooterpacket1.png', 'transparentpeashooter.png', 'bonkchoypacket1.png', 'bonkchoy1.png'];
  for (const f of files) {
    try {
      const img = await Jimp.read(path.join(base, f));
      console.log(`${f}: ${img.width}x${img.height}`);
    } catch (e) {
      console.error(f, e.message);
    }
  }
}
check();
