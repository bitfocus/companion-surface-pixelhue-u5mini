import type { OpenDeviceResult } from './types.js'
import { BUTTON_SIZE, GRID_COLS, GRID_ROWS } from './constants.js'

/**
 * 构建默认 surface 布局：
 * 生成每个按键的 (column,row) 坐标映射，并提供默认 bitmap 大小。
 */
export function buildSurfaceLayout(): OpenDeviceResult['surfaceLayout'] {
	const controls: Record<string, { column: number; row: number }> = {}

	for (let row = 0; row < GRID_ROWS; row++) {
		for (let col = 0; col < GRID_COLS; col++) {
			controls[`${col}_${row}`] = { column: col, row }
		}
	}

	return {
		controls,
		stylePresets: {
			default: {
				bitmap: { format: 'rgba', w: BUTTON_SIZE, h: BUTTON_SIZE },
			},
		},
	}
}

export const DEFAULT_SURFACE_LAYOUT = buildSurfaceLayout()
