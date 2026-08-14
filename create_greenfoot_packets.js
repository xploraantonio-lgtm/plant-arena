import { Jimp, loadFont } from 'jimp';
import path from 'path';

async function createPacket(spriteFileName, sunCost, outFileName) {
  const dir = path.join(process.cwd(), 'public', 'game-assets', 'greenfoot');
  
  // Base frame from peashooterpacket1.png or sunflowerpacket1.png
  const baseFrame = await Jimp.read(path.join(dir, 'peashooterpacket1.png'));
  const width = baseFrame.width;
  const height = baseFrame.height;

  // Read transparent plant sprite
  const sprite = await Jimp.read(path.join(dir, spriteFileName));

  // Clone base frame
  const packet = baseFrame.clone();

  // Create clean card canvas with wood border style
  // Crop inner area of sprite and overlay onto packet
  const innerSprite = sprite.clone();
  innerSprite.resize({ w: Math.floor(width * 0.65), h: Math.floor(height * 0.65) });

  // Composite sprite in center of card frame
  const xOffset = Math.floor((width - innerSprite.width) / 2);
  const yOffset = Math.floor((height - innerSprite.height) / 2) + 2;

  packet.composite(innerSprite, xOffset, yOffset);

  // Write output
  const outPath = path.join(dir, outFileName);
  await packet.write(outPath);
  console.log(`Successfully created Greenfoot PNG packet: ${outFileName} (${width}x${height})`);

  // Also copy to public/game-assets/plants/ for compatibility
  const plantsDir = path.join(process.cwd(), 'public', 'game-assets', 'plants');
  const plantIconName = outFileName.replace('packet1.png', '_icon.png');
  await packet.write(path.join(plantsDir, plantIconName));
  console.log(`Copied icon to plants/${plantIconName}`);
}

async function run() {
  await createPacket('transparentjalapeno.png', 125, 'jalapenopacket1.png');
  await createPacket('transparenticeberglettuce.png', 0, 'iceberglettucepacket1.png');
  await createPacket('transparentaloe.png', 100, 'aloepacket1.png');
}

run().catch(console.error);
