// Shared types between frontend and backend

export interface MissionConfig {
  launchWindow: string // ISO datetime string
  propulsionType: 'chemical' | 'ion' | 'nuclear'
  payload: Array<'camera' | 'spectrometer' | 'probe'>
  trajectoryType?: 'hohmann' | 'bi-elliptic' | 'gravity-assist'
  fuelCapacity?: number // kg
  missionDuration?: number // days
}

export interface MissionStatus {
  phase: 'PLANNING' | 'LAUNCH' | 'CRUISE' | 'APPROACH' | 'INTERCEPT' | 'COMPLETE' | 'FAILED'
  timeToIntercept?: string // HH:MM:SS format
  distanceToTarget?: number // km
  velocity?: number // km/s
  fuelRemaining?: number // percentage
  successProbability?: number // percentage
  missionElapsed?: string // HH:MM:SS format
}

export interface OrbitalElements {
  a: number // Semi-major axis (AU)
  e: number // Eccentricity
  i: number // Inclination (degrees)
  omega: number // Argument of periapsis (degrees)
  Omega: number // Longitude of ascending node (degrees)
  M: number // Mean anomaly (degrees)
  epoch: number // Julian date
}

export interface CelestialBody {
  id: string
  name: string
  type: 'planet' | 'moon' | 'asteroid' | 'comet' | 'star'
  position: [number, number, number] // x, y, z in AU
  velocity: [number, number, number] // vx, vy, vz in km/s
  mass: number // kg
  radius: number // km
  color: string
  orbitalElements?: OrbitalElements
}

export interface AtlasData {
  id: '3I/ATLAS'
  designation: 'C/2025 N1'
  discoveryDate: '2025-07-01'
  position: [number, number, number]
  velocity: [number, number, number]
  orbitalElements: OrbitalElements
  physicalProperties: {
    nucleusRadius: number // km (estimated)
    rotationPeriod: number // hours
    activity: 'active' | 'dormant'
    composition: string[]
  }
}

export interface TrajectoryPoint {
  time: number // Unix timestamp
  position: [number, number, number] // x, y, z in AU
  velocity: [number, number, number] // vx, vy, vz in km/s
  fuelMass: number // kg
  acceleration: [number, number, number] // ax, ay, az in m/s²
}

export interface InterceptorTrajectory {
  points: TrajectoryPoint[]
  totalDeltaV: number // m/s
  totalFuelUsed: number // kg
  flightTime: number // seconds
  interceptProbability: number // percentage
}

export interface SimulationState {
  id: string
  isRunning: boolean
  currentTime: number // Unix timestamp
  timeAcceleration: number // 1x, 10x, 100x, etc.
  elapsedTime: number // seconds since mission start
  config: MissionConfig
}

// API Response wrapper
export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
  timestamp: number
}

export interface MissionCalculationResponse {
  trajectory: InterceptorTrajectory
  estimatedFuelUsage: number
  interceptProbability: number
  timeToTarget: number
  warnings: string[]
}

// NASA API Types
export interface HorizonsApiParams {
  COMMAND: string
  CENTER: string
  START_TIME: string
  STOP_TIME: string
  STEP_SIZE: string
  TABLE_TYPE?: string
  QUANTITIES?: string
  OBJ_DATA?: 'YES' | 'NO'
  MAKE_EPHEM?: 'YES' | 'NO'
  format?: 'json' | 'text'
}

export interface HorizonsResponse {
  signature: any
  result: string
}

export interface NasaImageResponse {
  date: string
  explanation: string
  hdurl?: string
  media_type: string
  service_version: string
  title: string
  url: string
  thumbnail_url?: string
}

// Socket.IO Event types
export interface SocketEvents {
  'mission-update': (data: MissionStatus) => void
  'simulation-tick': (data: { 
    time: number
    positions: Record<string, [number, number, number]>
    velocities?: Record<string, [number, number, number]>
  }) => void
  'mission-alert': (data: {
    type: 'info' | 'warning' | 'error'
    message: string
    timestamp: number
  }) => void
  'update-mission-config': (config: MissionConfig) => void
  'request-trajectory-calculation': (config: MissionConfig) => void
}

// Error types
export interface ApiError extends Error {
  statusCode: number
  isOperational: boolean
}

// Mission calculation parameters
export interface MissionParameters {
  launchDate: Date
  targetBody: string
  spacecraft: {
    dryMass: number // kg
    fuelMass: number // kg
    propulsionType: MissionConfig['propulsionType']
    specificImpulse: number // seconds
  }
  constraints: {
    maxDeltaV: number // m/s
    maxFlightTime: number // days
    minInterceptDistance: number // km
  }
}
