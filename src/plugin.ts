import type { OpenSurfaceResult, SurfaceContext, SurfacePlugin } from '@companion-surface/base'
import { PixelhueSurfaceModule } from './surface-module.js'
import { DEFAULT_SURFACE_LAYOUT } from './layout.js'
import type { HostContext, OpenDeviceResult } from './types.js'
import { PixelhueRemote, type PixelhueRemoteDeviceInfo } from './remote.js'
import { PIXELHUE_U5_MINI_NAME } from './constants.js'

interface DrawProps {
	controlId?: string
	image?: Uint8Array
	page?: unknown
}

const surfaceContexts = new Map<string, SurfaceContext>()
let moduleInstance: PixelhueSurfaceModule | null = null

const remote = new PixelhueRemote(() => moduleInstance)

function emitSurfaceConnected(info: OpenDeviceResult): void {
	remote.emit('surfacesConnected', [
		{
			surfaceId: info.surfaceId,
			deviceHandle: info.surfaceId,
			description: info.description,
			pluginInfo: { type: 'remote' } satisfies PixelhueRemoteDeviceInfo,
		},
	])
}

function disconnectContext(surfaceId: string): void {
	const ctx = surfaceContexts.get(surfaceId)
	ctx?.disconnect(new Error('Disconnected'))
	surfaceContexts.delete(surfaceId)
}

const plugin: SurfacePlugin<PixelhueRemoteDeviceInfo> = {
	remote,
	/**
	 * SurfacePlugin 初始化：
	 * 创建 moduleInstance，并注入宿主上下文（用于桥接 discovery 与输入事件）。
	 */
	async init(): Promise<void> {
		if (moduleInstance) return

		const hostContext: HostContext = {
			connectionsFound: (infos) => {
				remote.emit('connectionsFound', infos)
			},
			connectionsForgotten: (connectionIds) => {
				remote.emit('connectionsForgotten', connectionIds)
			},
			notifyOpenedDiscoveredSurface: async (info: OpenDeviceResult) => {
				emitSurfaceConnected(info)
			},
			surfaceEvents: {
				inputPress: (surfaceId, controlId, pressed) => {
					const ctx = surfaceContexts.get(surfaceId)
					if (!ctx) return
					if (pressed) ctx.keyDownById(controlId)
					else ctx.keyUpById(controlId)
				},
				inputRotate: (surfaceId, controlId, delta) => {
					const ctx = surfaceContexts.get(surfaceId)
					if (!ctx) return
					if (delta >= 0) ctx.rotateRightById(controlId)
					else ctx.rotateLeftById(controlId)
				},
			},
			disconnected: (surfaceId) => {
				disconnectContext(surfaceId)
			},
		}

		moduleInstance = new PixelhueSurfaceModule(hostContext)
		await moduleInstance.init()
	},
	/**
	 * SurfacePlugin 销毁：
	 * 销毁 moduleInstance，并清理 surfaceContexts。
	 */
	async destroy(): Promise<void> {
		if (!moduleInstance) return
		await moduleInstance.destroy()
		moduleInstance = null
		surfaceContexts.clear()
	},
	/**
	 * 打开一个 surface：
	 * 创建给宿主调用的 surface API，并将宿主的 draw/close/变量等操作转发到 moduleInstance。
	 */
	async openSurface(
		surfaceId: string,
		_pluginInfo: PixelhueRemoteDeviceInfo,
		context: SurfaceContext,
	): Promise<OpenSurfaceResult> {
		surfaceContexts.set(surfaceId, context)

		const surface = {
			surfaceId,
			productName: PIXELHUE_U5_MINI_NAME,
			/** surface 初始化（本模块无额外初始化动作） */
			async init(): Promise<void> {},
			/** surface 关闭：移除 context 并关闭底层连接。 */
			async close(): Promise<void> {
				disconnectContext(surfaceId)
				await moduleInstance?.closeDevice(surfaceId)
			},
			async updateConfig(_config: Record<string, unknown>): Promise<void> {},
			async ready(): Promise<void> {},
			/** blank：清屏 */
			async blank(): Promise<void> {
				await moduleInstance?.blankSurface(surfaceId)
			},
			/** draw：将宿主的 draw props 转成 moduleInstance.draw 的参数格式。 */
			async draw(signal: { aborted?: boolean } | undefined, props: DrawProps): Promise<void> {
				if (signal?.aborted) return
				if (!props?.controlId) return
				const imageBuf = props.image ? Buffer.from(props.image) : undefined
				moduleInstance?.draw(surfaceId, [
					{
						controlId: String(props.controlId),
						image: imageBuf,
						page: props.page ?? null,
					},
				])
			},
			/** 接收变量更新并转发到 moduleInstance */
			async onVariableValue(name: string, value: unknown): Promise<void> {
				await moduleInstance?.onVariableValue(surfaceId, name, value)
			},
			/** 锁定状态展示 */
			async showLockedStatus(locked: boolean, characterCount: number): Promise<void> {
				await moduleInstance?.showLockedStatus(surfaceId, locked, characterCount)
			},
			/** brightness：本模块不直接使用 */
			async setBrightness(_brightness: number): Promise<void> {},
			/** showStatus：本模块不实现额外状态 */
			async showStatus(): Promise<void> {},
		}

		return {
			surface,
			registerProps: {
				brightness: true,
				surfaceLayout: DEFAULT_SURFACE_LAYOUT as any,
				pincodeMap: null,
				location: null,
				configFields: null,
			},
		}
	},
}

export default plugin
