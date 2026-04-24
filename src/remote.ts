import type { PixelhueSurfaceModule } from './surface-module.js'
import type {
	RemoteSurfaceConnectionInfo,
	SurfacePluginRemote,
	SurfacePluginRemoteEvents,
	SomeCompanionInputField,
} from '@companion-surface/base'
import EventEmitter from 'node:events'
import { remoteCheckConfigMatchesExpression, remoteConfigFields } from './constants.js'

export interface PixelhueRemoteDeviceInfo {
	type: 'remote'
}

export class PixelhueRemote
	extends EventEmitter<SurfacePluginRemoteEvents<PixelhueRemoteDeviceInfo>>
	implements SurfacePluginRemote<PixelhueRemoteDeviceInfo>
{
	readonly configFields: SomeCompanionInputField[] = remoteConfigFields

	// 用于 “Already added” 去重匹配
	readonly checkConfigMatchesExpression = remoteCheckConfigMatchesExpression

	/**
	 * 通过闭包拿到当前 moduleInstance，用于转发 host 的 start/stop。
	 */
	constructor(private readonly getModuleInstance: () => PixelhueSurfaceModule | null) {
		super()
	}
	rejectSurface(): void {}
	/**
	 * 宿主启动指定 connection 时调用：
	 * 透传到 moduleInstance.setupRemoteConnections。
	 */
	async startConnections(connectionInfos: RemoteSurfaceConnectionInfo[]): Promise<void> {
		const moduleInstance = this.getModuleInstance()
		if (!moduleInstance) return
		await moduleInstance.setupRemoteConnections(connectionInfos)
	}

	/**
	 * 宿主停止指定 connection 时调用：
	 * 透传到 moduleInstance.stopRemoteConnections。
	 */
	async stopConnections(connectionIds: string[]): Promise<void> {
		const moduleInstance = this.getModuleInstance()
		await moduleInstance?.stopRemoteConnections?.(connectionIds)
	}
}
