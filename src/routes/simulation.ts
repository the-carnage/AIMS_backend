import express, { Request, Response } from 'express'
import Joi from 'joi'
import { logger } from '../utils/logger.js'
import { catchAsync, ValidationError, NotFoundError } from '../middleware/errorHandler.js'
import { SimulationState, MissionConfig, MissionStatus } from '../types/index.js'
import OrbitalMechanics from '../services/orbitalMechanics.js'

const router = express.Router()

// In-memory simulation store (in production, use Redis or database)
const simulations = new Map<string, SimulationState>()
const simulationIntervals = new Map<string, NodeJS.Timeout>()

// Validation schema
const missionConfigSchema = Joi.object({
  launchWindow: Joi.string().isoDate().required(),
  propulsionType: Joi.string().valid('chemical', 'ion', 'nuclear').required(),
  payload: Joi.array().items(Joi.string().valid('camera', 'spectrometer', 'probe')).min(1).required(),
  trajectoryType: Joi.string().valid('hohmann', 'bi-elliptic', 'gravity-assist').optional(),
  fuelCapacity: Joi.number().positive().optional(),
  missionDuration: Joi.number().positive().optional()
})

function generateSimulationId(): string {
  return 'sim_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
}

router.post('/start', catchAsync(async (req: Request, res: Response) => {
  // Validate request body
  const { error, value } = missionConfigSchema.validate(req.body)
  if (error) {
    throw new ValidationError(`Invalid mission configuration: ${error.details[0].message}`)
  }

  const config: MissionConfig = value
  const simulationId = generateSimulationId()

  // Check if we're at max concurrent simulations
  if (simulations.size >= (parseInt(process.env.MAX_CONCURRENT_SIMULATIONS || '10'))) {
    return res.status(429).json({
      success: false,
      error: 'Maximum concurrent simulations reached',
      timestamp: Date.now()
    })
  }

  logger.info('Starting new simulation', {
    simulationId,
    config,
    requestId: (req as any).requestId
  })

  // Create simulation state
  const simulationState: SimulationState = {
    id: simulationId,
    isRunning: true,
    currentTime: Date.now(),
    timeAcceleration: 1,
    elapsedTime: 0,
    config
  }

  simulations.set(simulationId, simulationState)

  // Start simulation loop
  const interval = setInterval(() => {
    updateSimulation(simulationId)
  }, parseInt(process.env.SIMULATION_TIME_STEP || '1000'))

  simulationIntervals.set(simulationId, interval)

  res.json({
    success: true,
    data: {
      simulationId,
      state: simulationState
    },
    timestamp: Date.now()
  })
}))

function updateSimulation(simulationId: string): void {
  const simulation = simulations.get(simulationId)
  if (!simulation || !simulation.isRunning) {
    return
  }

  try {
    // Update simulation time
    simulation.currentTime = Date.now()
    simulation.elapsedTime += 1 // seconds

    // Calculate current positions
    const positions = OrbitalMechanics.getCurrentCelestialPositions(simulation.currentTime)

    // Calculate current mission status
    const missionStatus = calculateMissionStatus(simulation)

    // Emit updates via WebSocket (if available)
    const io = (global as any).io
    if (io) {
      io.emit('simulation-tick', {
        simulationId,
        time: simulation.currentTime,
        positions,
        status: missionStatus
      })
    }

    // Auto-stop simulation after reasonable time (1 year simulation time)
    if (simulation.elapsedTime > 365 * 24 * 60 * 60) {
      logger.info('Auto-stopping long-running simulation', { simulationId })

      const interval = simulationIntervals.get(simulationId)
      if (interval) {
        clearInterval(interval)
        simulationIntervals.delete(simulationId)
      }

      simulation.isRunning = false
    }

    simulations.set(simulationId, simulation)

  } catch (error) {
    logger.error('Error updating simulation', { simulationId, error })
  }
}

function calculateMissionStatus(simulation: SimulationState): MissionStatus {
  const elapsedDays = simulation.elapsedTime / (24 * 60 * 60)

  // Simple phase calculation based on elapsed time
  let phase: MissionStatus['phase'] = 'PLANNING'

  if (simulation.isRunning) {
    if (elapsedDays < 1) {
      phase = 'LAUNCH'
    } else if (elapsedDays < 30) {
      phase = 'CRUISE'
    } else if (elapsedDays < 365) {
      phase = 'APPROACH'
    } else {
      phase = 'INTERCEPT'
    }
  }

  const timeToIntercept = Math.max(365 - elapsedDays, 0)
  const distanceToTarget = Math.max(1000000 - (elapsedDays * 50000), 10000) // Simplified
  const velocity = 15 + (elapsedDays * 0.1) // Gradually increasing
  const fuelRemaining = Math.max(100 - (elapsedDays * 0.3), 0)

  return {
    phase,
    timeToIntercept: formatTime(timeToIntercept * 24 * 60 * 60), // Convert days to seconds
    distanceToTarget,
    velocity,
    fuelRemaining,
    successProbability: Math.max(85 - (elapsedDays * 0.1), 20),
    missionElapsed: formatTime(simulation.elapsedTime)
  }
}

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

export default router
