import { deflateSync } from 'zlib'
import { PNG_SIGNATURE } from '../constants.js'

function crc32(buf: Buffer): number {
	let crc = 0xffffffff
	for (let i = 0; i < buf.length; i++) {
		crc ^= buf[i]
		for (let j = 0; j < 8; j++) {
			const mask = -(crc & 1)
			crc = (crc >>> 1) ^ (0xedb88320 & mask)
		}
	}
	return (crc ^ 0xffffffff) >>> 0
}

function createPngChunk(type: string, data: Buffer): Buffer {
	const typeBuf = Buffer.from(type, 'ascii')
	const lengthBuf = Buffer.alloc(4)
	lengthBuf.writeUInt32BE(data.length, 0)

	const crcInput = Buffer.concat([typeBuf, data])
	const crcBuf = Buffer.alloc(4)
	crcBuf.writeUInt32BE(crc32(crcInput), 0)

	return Buffer.concat([lengthBuf, typeBuf, data, crcBuf])
}

export function rgbaToPngBuffer(rgba: Buffer, width: number, height: number): Buffer {
	const rowBytes = width * 4
	const raw = Buffer.alloc((rowBytes + 1) * height)
	for (let y = 0; y < height; y++) {
		const srcStart = y * rowBytes
		const dstStart = y * (rowBytes + 1)
		raw[dstStart] = 0 // 过滤器类型：无（None）
		rgba.copy(raw, dstStart + 1, srcStart, srcStart + rowBytes)
	}

	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(width, 0)
	ihdr.writeUInt32BE(height, 4)
	ihdr[8] = 8 // 位深度
	ihdr[9] = 6 // 颜色类型：RGBA
	ihdr[10] = 0 // 压缩方法
	ihdr[11] = 0 // 滤波器方法
	ihdr[12] = 0 // 交错方法

	const idatData = deflateSync(raw as Buffer)
	const iend = Buffer.alloc(0)

	return Buffer.concat([
		PNG_SIGNATURE,
		createPngChunk('IHDR', ihdr),
		createPngChunk('IDAT', idatData),
		createPngChunk('IEND', iend),
	])
}
