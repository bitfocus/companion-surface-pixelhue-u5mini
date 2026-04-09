import type { DiscoveredRemoteSurfaceInfo } from '@companion-surface/base'

export interface DrawItem {
	controlId: string
	page: unknown
	base64: string
}

export interface OpenConnection {
	connectionId: string
	socketWrapper: any
	connectionManager: any
	address: string
	port: number
	close: () => void
	drawQueue: DrawItem[]
	drawQueueRunning: boolean
	waitingSinceMs?: number
}

export interface HostContext {
	connectionsFound: (infos: DiscoveredRemoteSurfaceInfo[]) => void
	connectionsForgotten: (connectionIds: string[]) => void
	notifyOpenedDiscoveredSurface?: (info: OpenDeviceResult) => Promise<void>
	surfaceEvents?: {
		inputPress: (surfaceId: string, controlId: string, pressed: boolean) => void
		inputRotate: (surfaceId: string, controlId: string, delta: number) => void
	}
	disconnected?: (surfaceId: string) => void
}

export interface OpenDeviceResult {
	surfaceId: string
	description: string
	configFields: unknown[] | null
	surfaceLayout: {
		controls: Record<string, { column: number; row: number; stylePreset?: string }>
		stylePresets: {
			default: { bitmap?: { format: string; w: number; h: number } }
		}
	}
	location?: string
	isRemote?: boolean
	supportsBrightness?: boolean
}

export interface DeviceInfoT {
	name?: string
	address?: string
	port?: number
	serialNumber?: string
}
