import { Jimp } from 'jimp';
import path from 'path';

async function check() {
  const dir = path.join(process.cwd(), 'public', 'game-assets', 'greenfoot');
  const files = [
    'twinsunflowerpacket1.png',
    'sunflowerpacket1.png',
    'peashooterpacket1.png',
    'jalapenopacket1.png',
    'iceberglettucepacket1.png',
    'aloepacket1.png'
  ];

  for (const f of files) {
    try {
      const img = await Jimp.read(path.join(dir, f));
      console.log(`${f}: ${img.width}x${img.height}`);
    } catch (e) {
      console.error(f, e.message);
    }
  }
}

check();
