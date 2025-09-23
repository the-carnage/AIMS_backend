import express, { Request, Response } from 'express'
import Joi from 'joi'
import { logger } from '../utils/logger.js'
import { catchAsync, ValidationError } from '../middleware/errorHandler.js'
import { MissionConfig, MissionCalculationResponse } from '../types/index.js'
import OrbitalMechanics from '../services/orbitalMechanics.js'

const router = express.Router()

// Validation schema for mission configuration
const missionConfigSchema = Joi.object({
  launchWindow: Joi.string().isoDate().required(),
  propulsionType: Joi.string().valid('chemical', 'ion', 'nuclear').required(),
  payload: Joi.array().items(Joi.string().valid('camera', 'spectrometer', 'probe')).min(1).required(),
  trajectoryType: Joi.string().valid('hohmann', 'bi-elliptic', 'gravity-assist').optional(),
  fuelCapacity: Joi.number().positive().optional(),
  missionDuration: Joi.number().positive().optional()
})

router.post('/calculate', catchAsync(async (req: Request, res: Response) => {
  // Validate request body
  const { error, value } = missionConfigSchema.validate(req.body)
  if (error) {
    throw new ValidationError(`Invalid mission configuration: ${error.details[0].message}`)
  }

  const config: MissionConfig = value
  const launchTime = new Date(config.launchWindow).getTime()

  logger.info('Mission calculation requested', {
    config,
    requestId: (req as any).requestId
  })

  try {
    // Get current celestial body positions
    const positions = OrbitalMechanics.getCurrentCelestialPositions(launchTime)
    const earthPosition = positions['Earth']
    const atlasPosition = positions['3I/ATLAS']

    if (!earthPosition || !atlasPosition) {
      throw new Error('Unable to calculate celestial body positions')
    }

    // Calculate time of flight (simplified - should be optimized)
    const distance = Math.sqrt(
      (atlasPosition[0] - earthPosition[0]) ** 2 +
      (atlasPosition[1] - earthPosition[1]) ** 2 +
      (atlasPosition[2] - earthPosition[2]) ** 2
    )

    // Estimate flight time based on distance and propulsion type
    const velocityEstimates = {
      chemical: 15, // km/s average
      ion: 8, // km/s average (slower but efficient)
      nuclear: 25 // km/s average
    }

    const estimatedVelocity = velocityEstimates[config.propulsionType]
    const timeOfFlight = (distance * 149597870.7) / estimatedVelocity // Convert AU to km and calculate

    // Calculate intercept trajectory
    const trajectory = OrbitalMechanics.calculateInterceptTrajectory(
      earthPosition,
      atlasPosition,
      timeOfFlight,
      config
    )

    // Prepare response
    const response: MissionCalculationResponse = {
      trajectory,
      estimatedFuelUsage: trajectory.totalFuelUsed,
      interceptProbability: trajectory.interceptProbability,
      timeToTarget: trajectory.flightTime,
      warnings: []
    }

    // Add warnings based on mission parameters
    if (trajectory.interceptProbability < 50) {
      response.warnings.push('Low intercept probability - consider adjusting mission parameters')
    }

    if (trajectory.totalDeltaV > 12000) {
      response.warnings.push('High delta-V requirement - may exceed fuel capacity')
    }

    if (trajectory.flightTime > 3 * 365 * 24 * 60 * 60) { // 3 years
      response.warnings.push('Extended mission duration - consider reliability factors')
    }

    logger.info('Mission calculation completed', {
      requestId: (req as any).requestId,
      interceptProbability: trajectory.interceptProbability,
      flightTime: trajectory.flightTime / (24 * 60 * 60), // Convert to days
      warnings: response.warnings.length
    })

    res.json({
      success: true,
      data: response,
      timestamp: Date.now()
    })

  } catch (error) {
    logger.error('Mission calculation failed', {
      error: error instanceof Error ? error.message : String(error),
      config,
      requestId: (req as any).requestId
    })
    throw error
  }
}))

router.post('/validate', catchAsync(async (req: Request, res: Response) => {
  const { error, value } = missionConfigSchema.validate(req.body)

  if (error) {
    return res.json({
      success: true,
      data: {
        valid: false,
        warnings: error.details.map(detail => detail.message)
      },
      timestamp: Date.now()
    })
  }

  const config: MissionConfig = value
  const warnings: string[] = []

  // Check launch window timing
  const launchTime = new Date(config.launchWindow).getTime()
  const now = Date.now()

  if (launchTime < now) {
    warnings.push('Launch window is in the past')
  }

  if (launchTime > now + (5 * 365 * 24 * 60 * 60 * 1000)) { // 5 years from now
    warnings.push('Launch window is very far in the future - orbital predictions may be inaccurate')
  }

  // Check payload compatibility
  if (config.payload.includes('probe') && config.propulsionType === 'ion') {
    warnings.push('Ion propulsion may not provide sufficient thrust for probe deployment')
  }

  // Check fuel capacity vs propulsion type
  if (config.fuelCapacity && config.fuelCapacity < 1000 && config.propulsionType === 'chemical') {
    warnings.push('Low fuel capacity for chemical propulsion system')
  }

  res.json({
    success: true,
    data: {
      valid: true,
      warnings
    },
    timestamp: Date.now()
  })
}))

export default router
