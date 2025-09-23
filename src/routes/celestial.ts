import express, { Request, Response } from 'express'
import axios from 'axios'
import { logger } from '../utils/logger.js'
import { catchAsync, NotFoundError, InternalServerError } from '../middleware/errorHandler.js'
import { CelestialBody, AtlasData } from '../types/index.js'
import OrbitalMechanics, { ATLAS_3I_ELEMENTS, PLANETARY_ELEMENTS } from '../services/orbitalMechanics.js'

const router = express.Router()

const JPL_HORIZONS_URL = process.env.JPL_HORIZONS_API_URL || 'https://ssd.jpl.nasa.gov/api/horizons.api'

// Planet mapping for JPL Horizons API
const PLANET_CODES = {
  'Mercury': '199',
  'Venus': '299', 
  'Earth': '399',
  'Mars': '499',
  'Jupiter': '599',
  'Saturn': '699',
  'Uranus': '799',
  'Neptune': '899'
}

// Cache for planetary positions to avoid excessive API calls
const planetaryCache = new Map<string, { data: any, timestamp: number }>()
// Cache for ATLAS live position
const atlasCache = new Map<string, { position: [number, number, number]; timestamp: number }>()
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

// Static celestial body data
const CELESTIAL_BODIES: CelestialBody[] = [
  {
    id: 'sun',
    name: 'Sun',
    type: 'star',
    position: [0, 0, 0],
    velocity: [0, 0, 0],
    mass: 1.989e30,
    radius: 696340,
    color: '#FFD700'
  },
  {
    id: 'mercury',
    name: 'Mercury',
    type: 'planet',
    position: [0.387, 0, 0],
    velocity: [0, 47.87, 0],
    mass: 3.301e23,
    radius: 2439.7,
    color: '#8C7853',
    orbitalElements: PLANETARY_ELEMENTS.Mercury
  },
  {
    id: 'venus',
    name: 'Venus',
    type: 'planet',
    position: [0.723, 0, 0],
    velocity: [0, 35.02, 0],
    mass: 4.867e24,
    radius: 6051.8,
    color: '#FFC649',
    orbitalElements: PLANETARY_ELEMENTS.Venus
  },
  {
    id: 'earth',
    name: 'Earth',
    type: 'planet',
    position: [1.0, 0, 0],
    velocity: [0, 29.78, 0],
    mass: 5.972e24,
    radius: 6371,
    color: '#6B93D6',
    orbitalElements: PLANETARY_ELEMENTS.Earth
  },
  {
    id: 'mars',
    name: 'Mars',
    type: 'planet',
    position: [1.524, 0, 0],
    velocity: [0, 24.07, 0],
    mass: 6.39e23,
    radius: 3389.5,
    color: '#CD5C5C',
    orbitalElements: PLANETARY_ELEMENTS.Mars
  },
  {
    id: 'jupiter',
    name: 'Jupiter',
    type: 'planet',
    position: [5.204, 0, 0],
    velocity: [0, 13.07, 0],
    mass: 1.898e27,
    radius: 69911,
    color: '#D8CA9D',
    orbitalElements: PLANETARY_ELEMENTS.Jupiter
  }
]

// Function to fetch live planetary position from NASA JPL Horizons API
async function fetchPlanetaryPosition(planetName: string, time: number): Promise<[number, number, number] | null> {
  const cacheKey = `${planetName}_${Math.floor(time / CACHE_DURATION)}`
  
  // Check cache first
  const cached = planetaryCache.get(cacheKey)
  if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
    return cached.data
  }

  try {
    const planetCode = PLANET_CODES[planetName as keyof typeof PLANET_CODES]
    if (!planetCode) {
      logger.warn(`Unknown planet: ${planetName}`)
      return null
    }

    // Convert time to Julian date and format for API
    const julianDate = (time / 86400000) + 2440587.5
    const startDate = new Date(time - 86400000).toISOString().split('T')[0] // 1 day before
    const endDate = new Date(time + 86400000).toISOString().split('T')[0]   // 1 day after

    const params = {
      COMMAND: `'${planetCode}'`,
      CENTER: "'@sun'", // Heliocentric coordinates
      START_TIME: `'${startDate}'`,
      STOP_TIME: `'${endDate}'`,
      STEP_SIZE: "'1d'",
      TABLE_TYPE: "'VECTORS'",
      QUANTITIES: "'1'", // Position only
      OBJ_DATA: 'NO',
      MAKE_EPHEM: 'YES',
      format: 'json'
    }

    const response = await axios.get(JPL_HORIZONS_URL, {
      params,
      timeout: 15000,
      headers: {
        'User-Agent': 'AIMS-Backend/1.0.0 (Atlas Interceptor Mission Simulator)'
      }
    })

    // Parse the response to extract position
    const result = response.data?.result
    if (result && typeof result === 'string') {
      // Extract position data from the text response
      const lines = result.split('\n')
      let dataStarted = false
      
      for (const line of lines) {
        if (line.includes('$$SOE')) {
          dataStarted = true
          continue
        }
        if (line.includes('$$EOE')) {
          break
        }
        
        if (dataStarted && line.trim() && !line.startsWith('*')) {
          // Parse position data (format: JDTDB, X, Y, Z, VX, VY, VZ)
          const parts = line.trim().split(/\s+/)
          if (parts.length >= 4) {
            const x = parseFloat(parts[2])
            const y = parseFloat(parts[3]) 
            const z = parseFloat(parts[4])
            
            if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
              const position: [number, number, number] = [x, y, z]
              
              // Cache the result
              planetaryCache.set(cacheKey, { data: position, timestamp: Date.now() })
              
              logger.debug(`Fetched live position for ${planetName}`, { position })
              return position
            }
          }
        }
      }
    }

    logger.warn(`Could not parse position data for ${planetName}`)
    return null

  } catch (error) {
    logger.error(`Failed to fetch live position for ${planetName}`, {
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}

// Function to fetch all planetary positions
async function fetchAllPlanetaryPositions(time: number): Promise<Record<string, [number, number, number]>> {
  const positions: Record<string, [number, number, number]> = {}
  
  const planetNames = Object.keys(PLANET_CODES)
  const promises = planetNames.map(async (planetName) => {
    const position = await fetchPlanetaryPosition(planetName, time)
    if (position) {
      positions[planetName] = position
    }
  })

  await Promise.all(promises)
  return positions
}

// Fetch live position for 3I/ATLAS from JPL Horizons (best-effort)
async function fetchAtlasLivePosition(time: number): Promise<[number, number, number] | null> {
  const cacheKey = `atlas_${Math.floor(time / CACHE_DURATION)}`
  const cached = atlasCache.get(cacheKey)
  if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
    return cached.position
  }

  try {
    const startDate = new Date(time - 12 * 60 * 60 * 1000).toISOString().split('T')[0]
    const endDate = new Date(time + 12 * 60 * 60 * 1000).toISOString().split('T')[0]

    // Try multiple identifiers that JPL Horizons might accept
    const candidateCommands = ["'3I/ATLAS'", "'C/2025 N1'"]
    for (const COMMAND of candidateCommands) {
      const params = {
        COMMAND,
        CENTER: "'@sun'",
        START_TIME: `'${startDate}'`,
        STOP_TIME: `'${endDate}'`,
        STEP_SIZE: "'6h'",
        TABLE_TYPE: "'VECTORS'",
        QUANTITIES: "'1'",
        OBJ_DATA: 'NO',
        MAKE_EPHEM: 'YES',
        format: 'json'
      }

      const response = await axios.get(JPL_HORIZONS_URL, {
        params,
        timeout: 20000,
        headers: {
          'User-Agent': 'AIMS-Backend/1.0.0 (Atlas Interceptor Mission Simulator)'
        }
      })

      const result = response.data?.result
      if (result && typeof result === 'string') {
        const lines = result.split('\n')
        let inData = false
        // choose the row closest to requested time using JDTDB
        let bestPos: [number, number, number] | null = null
        let bestDt = Number.POSITIVE_INFINITY
        for (const line of lines) {
          if (line.includes('$$SOE')) { inData = true; continue }
          if (line.includes('$$EOE')) { break }
          if (inData && line.trim() && !line.startsWith('*')) {
            const parts = line.trim().split(/\s+/)
            // Expected: JDTDB, calendar date, X, Y, Z, VX, VY, VZ (varies by config)
            if (parts.length >= 5) {
              const jdt = parseFloat(parts[0])
              const x = parseFloat(parts[2])
              const y = parseFloat(parts[3])
              const z = parseFloat(parts[4])
              if ([jdt, x, y, z].every(Number.isFinite)) {
                const msFromJd = (jdt - 2440587.5) * 86400000
                const dt = Math.abs(msFromJd - time)
                if (dt < bestDt) {
                  bestDt = dt
                  const AU_KM = 149597870.7
                  bestPos = [x / AU_KM, y / AU_KM, z / AU_KM]
                }
              }
            }
          }
        }
        if (bestPos) {
          atlasCache.set(cacheKey, { position: bestPos, timestamp: Date.now() })
          logger.debug('Fetched live 3I/ATLAS position from JPL', { position: bestPos, command: COMMAND })
          return bestPos
        }
      }
    }
    logger.warn('Could not parse live 3I/ATLAS position from JPL response (tried multiple identifiers)')
    return null
  } catch (error) {
    logger.error('Failed to fetch live 3I/ATLAS position', { error: error instanceof Error ? error.message : String(error) })
    return null
  }
}

router.get('/bodies', catchAsync(async (req: Request, res: Response) => {
  const time = req.query.time ? Number(req.query.time) : Date.now()

  logger.debug('Celestial bodies requested', { time, requestId: (req as any).requestId })

  try {
    // Fetch live planetary positions from NASA API
    const livePositions = await fetchAllPlanetaryPositions(time)
    
    // Fallback to calculated positions if NASA API fails
    const fallbackPositions = OrbitalMechanics.getCurrentCelestialPositions(time)

    // Update body positions with live data where available
    const bodiesWithPositions = CELESTIAL_BODIES.map(body => ({
      ...body,
      position: livePositions[body.name] || fallbackPositions[body.name] || body.position,
      lastUpdated: time,
      dataSource: livePositions[body.name] ? 'nasa_live' : 'calculated'
    }))

    res.json({
      success: true,
      data: bodiesWithPositions,
      timestamp: Date.now(),
      metadata: {
        liveDataCount: Object.keys(livePositions).length,
        totalBodies: bodiesWithPositions.length
      }
    })
  } catch (error) {
    logger.error('Error fetching celestial bodies', { error: error instanceof Error ? error.message : String(error) })
    
    // Fallback to calculated positions
    const fallbackPositions = OrbitalMechanics.getCurrentCelestialPositions(time)
    const bodiesWithPositions = CELESTIAL_BODIES.map(body => ({
      ...body,
      position: fallbackPositions[body.name] || body.position,
      lastUpdated: time,
      dataSource: 'calculated_fallback'
    }))

    res.json({
      success: true,
      data: bodiesWithPositions,
      timestamp: Date.now(),
      warning: 'Using calculated positions due to API error'
    })
  }
}))

router.get('/atlas', catchAsync(async (req: Request, res: Response) => {
  const time = req.query.time ? Number(req.query.time) : Date.now()
  const julianTime = (time / 1000 / 86400) + 2440587.5 // Convert to Julian date

  logger.debug('3I/ATLAS data requested', { time, requestId: (req as any).requestId })

  // Try live; fallback to calculated
  const livePos = await fetchAtlasLivePosition(time)
  let position: [number, number, number]
  let velocity: [number, number, number]
  if (livePos) {
    position = livePos
    velocity = [0, 0, 0]
  } else {
    const state = OrbitalMechanics.calculatePositionAtTime(ATLAS_3I_ELEMENTS, julianTime)
    position = state.position
    velocity = state.velocity
  }

  const atlasData: AtlasData = {
    id: '3I/ATLAS',
    designation: 'C/2025 N1',
    discoveryDate: '2025-07-01',
    position,
    velocity,
    orbitalElements: ATLAS_3I_ELEMENTS,
    physicalProperties: {
      nucleusRadius: 1.4, // km (estimated from observations)
      rotationPeriod: 16.79, // hours
      activity: 'active',
      composition: ['H2O ice', 'CO2 ice', 'CO', 'HCN', 'dust']
    }
  }

  res.json({
    success: true,
    data: atlasData,
    timestamp: Date.now()
  })
}))

router.get('/positions', catchAsync(async (req: Request, res: Response) => {
  const time = req.query.time ? Number(req.query.time) : Date.now()

  logger.debug('Celestial positions requested', { time })

  try {
    // Fetch live planetary positions from NASA API
    const livePositions = await fetchAllPlanetaryPositions(time)
    
    // Fallback to calculated positions if needed
    const fallbackPositions = OrbitalMechanics.getCurrentCelestialPositions(time)
    
    // Try live ATLAS as well
    const atlasLive = await fetchAtlasLivePosition(time)
    const atlasPositions = atlasLive ? { '3I/ATLAS': atlasLive } : {}
    
    // Merge live and calculated positions (planetary + ATLAS)
    const allPositions = { ...fallbackPositions, ...livePositions, ...atlasPositions }

    res.json({
      success: true,
      data: allPositions,
      timestamp: Date.now(),
      metadata: {
        liveDataCount: Object.keys(livePositions).length + (atlasLive ? 1 : 0),
        dataSource: atlasLive ? 'mixed_nasa_calculated_with_atlas_live' : 'mixed_nasa_calculated'
      }
    })
  } catch (error) {
    logger.error('Error fetching live positions', { error: error instanceof Error ? error.message : String(error) })
    
    // Fallback to calculated positions only
    const positions = OrbitalMechanics.getCurrentCelestialPositions(time)

    res.json({
      success: true,
      data: positions,
      timestamp: Date.now(),
      warning: 'Using calculated positions due to API error'
    })
  }
}))

export default router
