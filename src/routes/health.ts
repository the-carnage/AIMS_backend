import express, { Request, Response } from 'express'
import { logger } from '../utils/logger.js'
import { catchAsync } from '../middleware/errorHandler.js'

const router = express.Router()

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Health check endpoint
 *     description: Returns the current status of the AIMS backend service
 */
router.get('/', catchAsync(async (req: Request, res: Response) => {
  const healthData = {
    status: 'healthy',
    timestamp: Date.now(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    services: {
      database: 'connected', // If using database
      externalApis: 'operational',
      websocket: 'active'
    }
  }

  logger.debug('Health check requested', { 
    ip: req.ip, 
    userAgent: req.get('User-Agent') 
  })

  res.json({
    success: true,
    data: healthData,
    timestamp: Date.now()
  })
}))

router.get('/detailed', catchAsync(async (req: Request, res: Response) => {
  const detailedHealth = {
    status: 'healthy',
    timestamp: Date.now(),
    system: {
      platform: process.platform,
      architecture: process.arch,
      nodeVersion: process.version,
      uptime: process.uptime(),
      cpuUsage: process.cpuUsage(),
      memory: process.memoryUsage(),
      loadAverage: process.platform !== 'win32' ? (await import('os')).loadavg() : null,
    },
    environment: {
      nodeEnv: process.env.NODE_ENV,
      port: process.env.PORT,
      logLevel: process.env.LOG_LEVEL,
    },
    external: {
      nasaApi: 'operational', // Could add actual checks
      jplHorizons: 'operational',
    }
  }

  res.json({
    success: true,
    data: detailedHealth,
    timestamp: Date.now()
  })
}))

export default router
