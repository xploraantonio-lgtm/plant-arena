import fs from 'fs';
import path from 'path';

const plantsDir = path.join(process.cwd(), 'public', 'game-assets', 'plants');
const greenfootDir = path.join(process.cwd(), 'public', 'game-assets', 'greenfoot');

const mappings = [
  {
    src: path.join(plantsDir, 'iceberg_user_hd.png'),
    dests: [
      path.join(plantsDir, 'iceberglettuce_hd.png'),
      path.join(plantsDir, 'iceberglettuce_icon.png'),
      path.join(plantsDir, 'iceberglettuce_sprite.png'),
      path.join(greenfootDir, 'iceberglettucepacket1.png'),
      path.join(greenfootDir, 'transparenticeberglettuce.png')
    ]
  },
  {
    src: path.join(plantsDir, 'jalapeno_user_hd.png'),
    dests: [
      path.join(plantsDir, 'jalapeno_hd.png'),
      path.join(plantsDir, 'jalapeno_icon.png'),
      path.join(plantsDir, 'jalapeno_sprite.png'),
      path.join(greenfootDir, 'jalapenopacket1.png'),
      path.join(greenfootDir, 'transparentjalapeno.png')
    ]
  },
  {
    src: path.join(plantsDir, 'aloe_user_hd.png'),
    dests: [
      path.join(plantsDir, 'aloe_hd.png'),
      path.join(plantsDir, 'aloe_icon.png'),
      path.join(plantsDir, 'aloe_sprite.png'),
      path.join(greenfootDir, 'aloepacket1.png'),
      path.join(greenfootDir, 'transparentaloe.png')
    ]
  }
];

async function main() {
  for (const m of mappings) {
    if (fs.existsSync(m.src)) {
      const data = fs.readFileSync(m.src);
      for (const d of m.dests) {
        fs.writeFileSync(d, data);
        console.log(`Copied ${m.src} -> ${d}`);
      }
    } else {
      console.log(`Src missing: ${m.src}`);
    }
  }
}

main();
