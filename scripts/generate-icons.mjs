// Generate simple placeholder app icons without an image-tool dependency.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const name = Buffer.from(type)
  const size = Buffer.alloc(4)
  size.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([size, name, data, crc])
}
mkdirSync('public/icons', { recursive: true })
for (const size of [192, 512]) {
  const pixels = Buffer.alloc(size * (size * 3 + 1))
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x / size
      const py = y / size
      const radius = Math.hypot(px - 0.5, py - 0.4)
      const shackle = py < 0.43 && radius > 0.115 && radius < 0.17
      const sides =
        py >= 0.39 &&
        py < 0.5 &&
        ((px > 0.33 && px < 0.39) || (px > 0.61 && px < 0.67))
      const body = px > 0.27 && px < 0.73 && py >= 0.46 && py < 0.76
      const keyhole =
        Math.hypot(px - 0.5, py - 0.59) < 0.035 ||
        (Math.abs(px - 0.5) < 0.018 && py > 0.59 && py < 0.68)
      const light = (shackle || sides || body) && !keyhole
      const offset = y * (size * 3 + 1) + 1 + x * 3
      pixels.set(light ? [248, 250, 249] : [40, 105, 81], offset)
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 2
  writeFileSync(
    `public/icons/icon-${size}.png`,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(pixels)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
}
