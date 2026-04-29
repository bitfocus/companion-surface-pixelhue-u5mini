import { MiniDiscoveryService, MiniConnectionManager } from '@pixelhue/event-controller-sdk'
import type { DiscoveredRemoteSurfaceInfo, RemoteSurfaceConnectionInfo } from '@companion-surface/base'
import { createModuleLogger } from '@companion-surface/base'
import { PNG } from 'pngjs'
import {
	BUTTON_HEIGHT,
	BUTTON_WIDTH,
	DEFAULT_TCP_PORT,
	MAX_DRAW_QUEUE_LENGTH,
	IPV4_REGEX,
	PIXELHUE_U5_MINI_NAME,
	CONNECTED_POLL_DELAY_MS,
	CONNECT_WAIT_TIMEOUT_MS,
} from './constants.js'
import { DEFAULT_SURFACE_LAYOUT } from './layout.js'
import type { DeviceInfoT, DrawItem, HostContext, OpenConnection, OpenDeviceResult } from './types.js'

class PixelhueSurfaceModule {
	readonly #logger = createModuleLogger('PixelhueSurfaceModule')
	readonly #context: HostContext
	#discovery: any = null
	/** surfaceId（endpoint级）-> OpenConnection */
	#openConnections = new Map<string, OpenConnection>()
	/** connectionId -> address:port */
	#activeConnections = new Map<string, string>()
	/** address:port -> 引用计数 */
	#connectionRefCounts = new Map<string, number>()
	/** address:port -> 共享的已建立连接 */
	#sharedConnections = new Map<string, OpenConnection>()
	/** address:port -> 建连中的 Promise（防止并发重复 connectTo） */
	#connectingPromises = new Map<string, Promise<void>>()
	/** address:port -> surfaceId（endpoint级唯一） */
	#surfaceIdByAddress = new Map<string, string>()
	/** surfaceId -> address:port */
	#addressBySurfaceId = new Map<string, string>()
	/** 每个 connectionId 只通知一次 opened */
	#openedSurfaceIds = new Set<string>()

	/**
	 * 构造函数：持有宿主上下文，用于上报 discovery 候选、设备打开结果、按键事件等。
	 */
	constructor(hostContext: HostContext) {
		this.#context = hostContext
	}

	/**
	 * 初始化模块：
	 * 1) 创建 TCP 连接管理器，用于建立出站连接；
	 * 2) 启动（可选）mDNS/Bonjour discovery，将发现的设备转换为候选连接上报给宿主。
	 */
	async init(): Promise<void> {
		this.#discovery = null

		const discovery = new MiniDiscoveryService()
		discovery.on('up', (device: { name?: string; address?: string; port?: number }) => {
			this.#reportDiscovered([this.#toDiscoveredInfo(device)])
		})
		discovery.on('down', (device: { address?: string; port?: number }) => {
			this.#context.connectionsForgotten([this.#connectionId(device)])
		})
		discovery?.query?.()
		this.#discovery = discovery
	}

	/**
	 * 销毁模块：
	 * 销毁 discovery 实例、关闭所有已打开连接。
	 */
	async destroy(): Promise<void> {
		this.#discovery?.destroy?.()
		this.#discovery = null
		for (const conn of this.#openConnections.values()) {
			try {
				conn.close()
			} catch {
				// ignore close errors during teardown
			}
		}
		this.#openConnections.clear()
		this.#activeConnections.clear()
		this.#connectionRefCounts.clear()
		this.#sharedConnections.clear()
		this.#connectingPromises.clear()
		this.#surfaceIdByAddress.clear()
		this.#addressBySurfaceId.clear()
		this.#openedSurfaceIds.clear()
	}

	/**
	 * 启用 outbound 连接时建立 TCP 连接。
	 * 规则：模块内部不主动断开已经建立的连接，仅为未打开的 connectionId 建连。
	 */
	async setupRemoteConnections(connectionInfos: RemoteSurfaceConnectionInfo[]): Promise<void> {
		this.#logger.debug(`connectionInfos: ${JSON.stringify(connectionInfos)}`)
		for (const { connectionId, config } of connectionInfos) {
			const rawAddress = config?.address ?? config?.ipAddress
			const address = rawAddress != null ? String(rawAddress).trim() : ''
			if (!address || address === '--') continue
			if (!IPV4_REGEX.test(address)) {
				this.#logger.warn(`Invalid IP address for ${connectionId}: ${address}`)
				continue
			}

			const portNum = Number(config?.port)
			const port = Number.isFinite(portNum) && portNum >= 1 && portNum <= 65535 ? Math.floor(portNum) : DEFAULT_TCP_PORT
			const addressKey = `${address}:${port}`
			const surfaceId = this.#surfaceIdFromEndpoint(address, port)
			this.#surfaceIdByAddress.set(addressKey, surfaceId)
			this.#addressBySurfaceId.set(surfaceId, addressKey)

			// 无实际变化的更新
			const oldAddressKey = this.#activeConnections.get(connectionId)
			if (oldAddressKey === addressKey) continue

			// 若 connectionId 已存在但目标地址不同，先释放旧引用
			if (oldAddressKey !== undefined) {
				this.#releaseConnectionReference(connectionId, oldAddressKey)
			}

			// 记录 connectionId -> addressKey 的映射
			this.#activeConnections.set(connectionId, addressKey)

			const currentRefCount = this.#connectionRefCounts.get(addressKey) ?? 0
			this.#connectionRefCounts.set(addressKey, currentRefCount + 1)

			// 若该 address:port 已连接，则复用同一条 socket，并通过 connectionId 进行别名
			const existingShared = this.#sharedConnections.get(addressKey)
			if (existingShared) {
				this.#openConnections.set(surfaceId, existingShared)
				if (existingShared.socketWrapper?.isConnected?.()) {
					this.#notifyOpenedSurface(surfaceId, address, port)
				}
				continue
			}

			const pending = this.#connectingPromises.get(addressKey)
			if (pending) {
				await pending
				const sharedAfterPending = this.#sharedConnections.get(addressKey)
				if (sharedAfterPending) {
					this.#openConnections.set(surfaceId, sharedAfterPending)
					if (sharedAfterPending.socketWrapper?.isConnected?.()) {
						this.#notifyOpenedSurface(surfaceId, address, port)
					}
				} else {
					// 并发等待的建连失败，回滚本次预先增加的映射与引用计数
					this.#releaseConnectionReference(connectionId, addressKey)
				}
				continue
			}

			try {
				const connectPromise = (async (): Promise<void> => {
					const connectionManager = new MiniConnectionManager()
					const socketWrapper = await connectionManager.connectTo(address, port)
					this.#onConnected({ surfaceId, addressKey, socketWrapper, connectionManager, address, port })
				})()
				this.#connectingPromises.set(addressKey, connectPromise)
				await connectPromise
			} catch (error: unknown) {
				this.#logger.error(`Failed to connect to ${address}:${port}: ${JSON.stringify(error)}`)
				// 连接失败，回滚引用计数等记录
				this.#releaseConnectionReference(connectionId, addressKey)
			} finally {
				this.#connectingPromises.delete(addressKey)
			}
		}
	}

	/**
	 * 停止指定远程连接：
	 * 关闭对应的 socket/连接并清理内部状态。
	 */
	async stopRemoteConnections(connectionIds: string[]): Promise<void> {
		const dedupedConnectionIds = new Set(connectionIds)
		for (const id of dedupedConnectionIds) {
			const addressKey = this.#activeConnections.get(id)
			if (!addressKey) continue
			this.#releaseConnectionReference(id, addressKey)
		}
	}

	/**
	 * 关闭某个 surface：
	 * 当宿主明确关闭 surface 时，关闭对应连接。
	 */
	async closeDevice(surfaceId: string): Promise<void> {
		const addressKey = this.#addressBySurfaceId.get(surfaceId)
		if (!addressKey) return
		const idsToRelease: string[] = []
		for (const [connectionId, key] of this.#activeConnections.entries()) {
			if (key === addressKey) idsToRelease.push(connectionId)
		}
		for (const connectionId of idsToRelease) {
			this.#releaseConnectionReference(connectionId, addressKey)
		}
	}

	/**
	 * 绘制（draw）：
	 * 将宿主传入的绘制请求入队列，并通过 #drainDrawQueue 顺序发送给设备，
	 * 防止短时间内大量发送造成卡顿/内存积压。
	 */
	async draw(
		surfaceId: string,
		drawProps: Array<{
			controlId?: string
			image?: Buffer | string
			page?: unknown
		}>,
	): Promise<void> {
		const conn = this.#openConnections.get(surfaceId)
		if (!conn || conn.drawQueue.length + drawProps.length > MAX_DRAW_QUEUE_LENGTH) {
			return
		}

		for (const prop of drawProps) {
			const controlId = prop.controlId ?? ''
			const [col, row] = controlId.split('_').map(Number)
			if (isNaN(col) || isNaN(row) || !Buffer.isBuffer(prop.image)) {
				this.#logger.warn(
					`draw skipped: unsupported image type surfaceId=${surfaceId} controlId=${controlId} imageType=${typeof prop.image}`,
				)
				continue
			}

			const png = new PNG({ width: BUTTON_WIDTH, height: BUTTON_HEIGHT })
			prop.image.copy(png.data)
			const pngBytes = PNG.sync.write(png)
			const base64 = `base64,${pngBytes.toString('base64')}`

			const item: DrawItem = {
				controlId,
				page: prop.page ?? null,
				base64,
			}
			conn.drawQueue.push(item)
		}

		this.#drainDrawQueue(surfaceId)
	}

	/**
	 * blank：清屏
	 */
	async blankSurface(_surfaceId: string): Promise<void> {}

	/**
	 * setBrightness：当前协议未实现，保留接口空实现。
	 */
	async setBrightness(_surfaceId: string, _brightness: number): Promise<void> {}

	/**
	 * showStatus：当前协议未实现，保留接口空实现。
	 */
	async showStatus(_surfaceId: string): Promise<void> {}

	/**
	 * onVariableValue：output variable 更新。
	 */
	async onVariableValue(_surfaceId: string, _name: string, _value: unknown): Promise<void> {}

	/**
	 * showLockedStatus：locked 状态展示。
	 * 本模块当前不使用 locked 状态，保留接口空实现。
	 */
	async showLockedStatus(_surfaceId: string, _locked: boolean, _characterCount: number): Promise<void> {}

	/**
	 * TCP 连接建立后回调：
	 * 绑定 socket 事件（data/disconnected/error），并向宿主上报该远程 surface 已打开。
	 */
	#onConnected({
		surfaceId,
		addressKey,
		socketWrapper,
		connectionManager,
		address,
		port,
	}: {
		surfaceId: string
		addressKey: string
		socketWrapper: any
		connectionManager: any
		address: string
		port: number
	}): void {
		let closed = false

		const close = (): void => {
			if (closed) return
			const current = this.#openConnections.get(surfaceId)
			if (current && current.socketWrapper !== socketWrapper) {
				return
			}
			closed = true
			try {
				connectionManager?.disconnectFrom?.(address, port, {
					autoReconnect: true,
				})
			} catch {
				// ignore disconnect errors during close
			}
			// 删除所有指向该 endpoint 的别名连接
			for (const [id, key] of this.#activeConnections.entries()) {
				if (key === addressKey) {
					this.#activeConnections.delete(id)
				}
			}
			this.#openConnections.delete(surfaceId)
			this.#openedSurfaceIds.delete(surfaceId)
			this.#surfaceIdByAddress.delete(addressKey)
			this.#addressBySurfaceId.delete(surfaceId)
			this.#context.disconnected?.(surfaceId)
			this.#connectionRefCounts.delete(addressKey)
			this.#sharedConnections.delete(addressKey)
		}

		const conn: OpenConnection = {
			connectionId: surfaceId,
			socketWrapper,
			connectionManager,
			address,
			port,
			close,
			drawQueue: [],
			drawQueueRunning: false,
		}
		this.#sharedConnections.set(addressKey, conn)
		this.#openConnections.set(surfaceId, conn)

		socketWrapper.on?.('connected', () => {
			this.#notifyOpenedSurface(surfaceId, address, port)

			// If there are queued draw items, try draining now.
			if (conn.drawQueue.length > 0) {
				this.#drainDrawQueue(surfaceId)
			}
		})

		// 某些实现里 connectTo 返回时可能已经 connected，兜底补发 opened。
		if (socketWrapper?.isConnected?.()) {
			this.#notifyOpenedSurface(surfaceId, address, port)
			if (conn.drawQueue.length > 0) {
				this.#drainDrawQueue(surfaceId)
			}
		}

		socketWrapper.on?.('data', (data: unknown, _requestId: number) => {
			this.#handleDeviceData(surfaceId, data as Record<string, unknown>)
		})
		socketWrapper.on?.('error', (error: Error) => {
			const tcpWrapper = socketWrapper.getTcpWrapper?.()
			const currentAddress = tcpWrapper?.getAddress?.() ?? 'unknown'
			const currentPort = tcpWrapper?.getPort?.() ?? 'unknown'
			this.#logger.error(`Device error [${currentAddress}:${currentPort}]: ${error.message}`)
			if (error.message?.includes?.('ECONNRESET')) {
				close()
			}
		})
		socketWrapper.on?.('disconnected', () => {
			const tcpWrapper = socketWrapper.getTcpWrapper?.()
			const currentAddress = tcpWrapper?.getAddress?.() ?? 'unknown'
			const currentPort = tcpWrapper?.getPort?.() ?? 'unknown'
			this.#logger.info(`Device connection closed [${currentAddress}:${currentPort}]`)
			close()
		})
	}

	/**
	 * 处理来自设备的原始数据，并转换为宿主的输入事件：
	 * - 按键 press/release => inputPress
	 */
	#handleDeviceData(surfaceId: string, data: Record<string, unknown>): void {
		try {
			this.#logger.debug(`receive data surfaceId=${surfaceId} payload=${JSON.stringify(data)}`)
		} catch {
			// ignore payload stringify/log errors
		}
		if (!data || typeof data !== 'object') return

		const events = this.#context.surfaceEvents
		if (!events) return
		if (data.type === 0 || data.type === 1) {
			const pressed = data.type === 0
			const controlId = `${Number(data.column)}_${Number(data.row)}`
			this.#logger.debug(
				`send inputPress surfaceId=${surfaceId} controlId=${controlId} pressed=${pressed} data=${JSON.stringify(data)}`,
			)
			events.inputPress(surfaceId, controlId, pressed)
		}
	}

	/**
	 * 同一个 address:port 只建立一条底层连接,多个 connectionId 可以引用同一条底层连接,关闭其中一个 connectionId 只减引用计数, 只有引用归0时才真正断开 socket
	 */
	#releaseConnectionReference(connectionId: string, addressKey: string): void {
		this.#activeConnections.delete(connectionId)

		const currentRefCount = this.#connectionRefCounts.get(addressKey)
		if (currentRefCount === undefined) return

		if (currentRefCount <= 1) {
			this.#connectionRefCounts.delete(addressKey)
			const shared = this.#sharedConnections.get(addressKey)
			this.#sharedConnections.delete(addressKey)
			shared?.close()
		} else {
			this.#connectionRefCounts.set(addressKey, currentRefCount - 1)
		}
	}

	/**
	 * 从绘制队列中逐条发送到设备：
	 * 每次只发送一个，然后用 setImmediate 触发下一次，避免一次性阻塞。
	 */
	#drainDrawQueue(surfaceId: string): void {
		const conn = this.#openConnections.get(surfaceId)
		if (!conn || conn.drawQueueRunning || conn.drawQueue.length === 0) return
		conn.drawQueueRunning = true

		const sendOne = (): void => {
			const c = this.#openConnections.get(surfaceId)
			if (!c) {
				conn.drawQueueRunning = false
				return
			}
			const sdkConnected = !!c.socketWrapper?.isConnected?.()
			// 保护机制，防止连接丢失后，drawQueueRunning 一直为 true，导致内存泄漏
			if (!sdkConnected) {
				c.waitingSinceMs ??= Date.now()
				if (Date.now() - c.waitingSinceMs > CONNECT_WAIT_TIMEOUT_MS) {
					c.drawQueue.length = 0
					c.waitingSinceMs = undefined
					c.drawQueueRunning = false
					return
				}
				setTimeout(sendOne, CONNECTED_POLL_DELAY_MS)
				return
			}
			c.waitingSinceMs = undefined
			const item = c.drawQueue.shift()
			if (!item) {
				c.drawQueueRunning = false
				return
			}

			const [col, row] = item.controlId.split('_').map(Number)
			try {
				this.#logger.info(
					`draw send surfaceId=${surfaceId} controlId=${item.controlId} column=${col} row=${row} base64Length=${item.base64.length} page=${item.page}`,
				)
				c.socketWrapper?.send?.({
					page: item.page ?? null,
					column: col,
					row,
					data: item.base64,
				})
			} catch {
				// ignore send errors; queue continues
			}

			setImmediate(() => sendOne())
		}

		sendOne()
	}

	/**
	 * 生成连接/表面使用的唯一 id：
	 */
	#connectionId(device: DeviceInfoT): string {
		return `${PIXELHUE_U5_MINI_NAME}-${device.serialNumber ?? `${PIXELHUE_U5_MINI_NAME}_${device.address}_${device.port}`}`
	}

	#surfaceIdFromEndpoint(address: string, port: number): string {
		return `${PIXELHUE_U5_MINI_NAME}:${address}:${port}`
	}

	/**
	 * 把 discovery 得到的 device 信息转换成宿主可展示的“发现候选”结构。
	 */
	#toDiscoveredInfo(device: DeviceInfoT): DiscoveredRemoteSurfaceInfo {
		const id = this.#connectionId(device)
		const address = device.address ?? null
		return {
			id,
			displayName: (device.name as string) ?? PIXELHUE_U5_MINI_NAME,
			description: PIXELHUE_U5_MINI_NAME,
			addresses: address,
			config: {
				address: address ?? '--',
				port: device.port ?? DEFAULT_TCP_PORT,
			},
		}
	}

	/**
	 * 向宿主上报 discovery 候选连接列表（connectionsFound）。
	 */
	#reportDiscovered(infos: DiscoveredRemoteSurfaceInfo[]): void {
		this.#context.connectionsFound(infos)
	}

	#notifyOpenedSurface(surfaceId: string, address: string, port: number): void {
		if (this.#openedSurfaceIds.has(surfaceId)) return
		this.#openedSurfaceIds.add(surfaceId)

		const info: OpenDeviceResult = {
			surfaceId,
			description: PIXELHUE_U5_MINI_NAME,
			configFields: null,
			surfaceLayout: DEFAULT_SURFACE_LAYOUT,
			location: `${address}:${port}`,
			isRemote: true,
			supportsBrightness: false,
		}
		this.#context.notifyOpenedDiscoveredSurface?.(info).catch((error: unknown) => {
			this.#logger.error(`Failed to notify opened discovered surface: ${JSON.stringify(error)}`)
		})
	}
}

export { PixelhueSurfaceModule }
