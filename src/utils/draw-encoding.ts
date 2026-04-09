import { BUTTON_HEIGHT, BUTTON_WIDTH } from '../constants.js'
import { rgbaToPngBuffer } from './png.js'

/**
 * Companion 4.3 surface 可能传入 RGBA / RGB 原始像素；转为 PNG 字节。
 * 尺寸不符时返回 null。
 */
export function companionRawPixelsToPngBytes(image: Buffer): Buffer | null {
	const rgbaLen = BUTTON_WIDTH * BUTTON_HEIGHT * 4
	const rgbLen = BUTTON_WIDTH * BUTTON_HEIGHT * 3

	if (image.length === rgbaLen) {
		return rgbaToPngBuffer(image, BUTTON_WIDTH, BUTTON_HEIGHT)
	}
	if (image.length === rgbLen) {
		const rgba = Buffer.alloc(rgbaLen)
		for (let i = 0; i < BUTTON_WIDTH * BUTTON_HEIGHT; i++) {
			const src = i * 3
			const dst = i * 4
			rgba[dst] = image[src]
			rgba[dst + 1] = image[src + 1]
			rgba[dst + 2] = image[src + 2]
			rgba[dst + 3] = 255
		}
		return rgbaToPngBuffer(rgba, BUTTON_WIDTH, BUTTON_HEIGHT)
	}
	return null
}

/** Pixelhue 协议期望 `base64,<...>` 前缀 */
export function pngBytesToPixelhueBase64(pngBytes: Buffer): string {
	return `base64,${pngBytes.toString('base64')}`
}
