import express, { Request, Response } from 'express'
import axios from 'axios'
import { logger } from '../utils/logger.js'
import { catchAsync, InternalServerError } from '../middleware/errorHandler.js'
import { HorizonsApiParams, HorizonsResponse, NasaImageResponse } from '../types/index.js'

const router = express.Router()

const NASA_API_KEY = process.env.NASA_API_KEY || 'DEMO_KEY'
const JPL_HORIZONS_URL = process.env.JPL_HORIZONS_API_URL || 'https://ssd.jpl.nasa.gov/api/horizons.api'
const NASA_API_BASE_URL = 'https://api.nasa.gov'

router.get('/horizons', catchAsync(async (req: Request, res: Response) => {
  const { target, start, end, step = '1d' } = req.query

  if (!target || !start || !end) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameters: target, start, end',
      timestamp: Date.now()
    })
  }

  logger.info('JPL Horizons API request', {
    target,
    start,
    end,
    step,
    requestId: (req as any).requestId
  })

  try {
    // Map common target names to JPL codes
    const targetMapping: Record<string, string> = {
      '3I/ATLAS': 'C/2025 N1',
      '3i-atlas': 'C/2025 N1',
      'atlas': 'C/2025 N1',
      'earth': '399',
      'mars': '499',
      'jupiter': '599',
      'venus': '299',
      'mercury': '199',
      'sun': '10'
    }

    const mappedTarget = targetMapping[target as string] || target

    // Build Horizons API parameters
    const params: HorizonsApiParams = {
      COMMAND: `'${mappedTarget}'`,
      CENTER: "'@sun'", // Heliocentric
      START_TIME: `'${start}'`,
      STOP_TIME: `'${end}'`,
      STEP_SIZE: `'${step}'`,
      TABLE_TYPE: "'VECTORS'",
      QUANTITIES: "'1,2,3'", // x,y,z position and velocity
      OBJ_DATA: 'YES',
      MAKE_EPHEM: 'YES',
      format: 'json'
    }

    // Make request to JPL Horizons API
    const response = await axios.get(JPL_HORIZONS_URL, {
      params,
      timeout: 30000, // 30 second timeout
      headers: {
        'User-Agent': 'AIMS-Backend/1.0.0 (Atlas Interceptor Mission Simulator)'
      }
    })

    logger.debug('JPL Horizons API response received', {
      status: response.status,
      dataLength: response.data?.result?.length || 0
    })

    // Parse and clean the response
    const horizonsData: HorizonsResponse = response.data

    res.json({
      success: true,
      data: horizonsData,
      metadata: {
        target: target as string,
        mappedTarget,
        startTime: start as string,
        endTime: end as string,
        stepSize: step as string
      },
      timestamp: Date.now()
    })

  } catch (error) {
    logger.error('JPL Horizons API error', {
      error: error instanceof Error ? error.message : String(error),
      target,
      start,
      end
    })

    if (axios.isAxiosError(error)) {
      const statusCode = error.response?.status || 500
      const errorMessage = error.response?.data?.message || error.message

      return res.status(statusCode).json({
        success: false,
        error: 'JPL Horizons API error',
        details: errorMessage,
        timestamp: Date.now()
      })
    }

    throw new InternalServerError('Failed to fetch data from JPL Horizons API')
  }
}))

router.get('/apod', catchAsync(async (req: Request, res: Response) => {
  const { date } = req.query

  logger.info('NASA APOD request', { date, requestId: (req as any).requestId })

  try {
    const params: any = {
      api_key: NASA_API_KEY
    }

    if (date) {
      params.date = date
    }

    const response = await axios.get(`${NASA_API_BASE_URL}/planetary/apod`, {
      params,
      timeout: 15000
    })

    const apodData: NasaImageResponse = response.data

    res.json({
      success: true,
      data: apodData,
      timestamp: Date.now()
    })

  } catch (error) {
    logger.error('NASA APOD API error', {
      error: error instanceof Error ? error.message : String(error),
      date
    })

    if (axios.isAxiosError(error)) {
      const statusCode = error.response?.status || 500
      return res.status(statusCode).json({
        success: false,
        error: 'NASA APOD API error',
        details: error.response?.data?.error?.message || error.message,
        timestamp: Date.now()
      })
    }

    throw new InternalServerError('Failed to fetch NASA APOD data')
  }
}))

export default router
