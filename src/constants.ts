import type { SomeCompanionInputField } from '@companion-surface/base'

/** 发现列表 “Already added” 去重表达式：address + port 相同认为是同一个连接 */
export const remoteCheckConfigMatchesExpression = '$(objA:address) === $(objB:address) && $(objA:port) == $(objB:port)'
export const GRID_COLS = 10
export const GRID_ROWS = 4

export const DEFAULT_TCP_PORT = 17100
export const BUTTON_SIZE = 72

/** 绘制请求队列长度上限：避免短时间大量 draw 导致内存与卡顿 */
export const MAX_DRAW_QUEUE_LENGTH = 50

/** draw 队列在 socket 未就绪时的轮询间隔 */
export const CONNECTED_POLL_DELAY_MS = 300

/** draw 队列等待 socket 就绪的最长时间，超时后丢弃积压帧 */
export const CONNECT_WAIT_TIMEOUT_MS = 15000

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
export const BUTTON_WIDTH = 72
export const BUTTON_HEIGHT = 72
export const PIXELHUE_U5_MINI_NAME = 'Pixelhue U5 Mini'

// IPv4 dotted-quad validation, range-limited to avoid passing invalid strings to connectTo()
export const IPV4_REGEX = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/
/** outbound 配置字段（当前模块只允许配置 Port） */
export const remoteConfigFields: SomeCompanionInputField[] = [
	{
		type: 'textinput',
		id: 'address',
		label: 'IP Address',
		default: '',
	},
	{
		type: 'number',
		id: 'port',
		label: 'Port',
		default: DEFAULT_TCP_PORT,
		min: 1,
		max: 65535,
		step: 1,
	},
]
