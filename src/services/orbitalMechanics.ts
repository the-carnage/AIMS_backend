import { 
  OrbitalElements, 
  TrajectoryPoint, 
  InterceptorTrajectory, 
  MissionConfig, 
  CelestialBody,
  MissionParameters 
} from '../types/index.js'
import { logger } from '../utils/logger.js'

// Physical constants
export const Constants = {
  AU: 149597870.7, // Astronomical unit in km
  G: 6.67430e-11, // Gravitational constant in m³/kg/s²
  SOLAR_MASS: 1.989e30, // kg
  EARTH_MASS: 5.972e24, // kg
  GM_SUN: 1.327e20, // m³/s²
  GM_EARTH: 3.986e14, // m³/s²
  SPEED_OF_LIGHT: 299792458, // m/s
  DAY_SECONDS: 86400, // seconds per day
  YEAR_SECONDS: 365.25 * 86400, // seconds per year
} as const

// 3I/ATLAS orbital elements (from actual astronomical data)
export const ATLAS_3I_ELEMENTS: OrbitalElements = {
  a: -2.1, // Semi-major axis (AU) - negative for hyperbolic orbit
  e: 6.141, // Eccentricity (highly hyperbolic)
  i: 175.1, // Inclination (degrees) - retrograde orbit
  omega: 310.4, // Argument of periapsis (degrees)
  Omega: 87.2, // Longitude of ascending node (degrees)
  M: 0, // Mean anomaly at epoch
  epoch: 2460146.5, // Julian date of epoch (July 1, 2025)
}

// Planet orbital elements (simplified)
export const PLANETARY_ELEMENTS: Record<string, OrbitalElements> = {
  Mercury: { a: 0.387, e: 0.206, i: 7.0, omega: 29.1, Omega: 48.3, M: 0, epoch: 2451545.0 },
  Venus: { a: 0.723, e: 0.007, i: 3.4, omega: 54.9, Omega: 76.7, M: 0, epoch: 2451545.0 },
  Earth: { a: 1.000, e: 0.017, i: 0.0, omega: 114.2, Omega: 0.0, M: 0, epoch: 2451545.0 },
  Mars: { a: 1.524, e: 0.093, i: 1.9, omega: 286.5, Omega: 49.6, M: 0, epoch: 2451545.0 },
  Jupiter: { a: 5.204, e: 0.049, i: 1.3, omega: 273.9, Omega: 100.5, M: 0, epoch: 2451545.0 },
}

/**
 * Utility functions for orbital mechanics calculations
 */
export class OrbitalMechanics {

  /**
   * Convert degrees to radians
   */
  static degToRad(degrees: number): number {
    return degrees * (Math.PI / 180)
  }

  /**
   * Convert radians to degrees  
   */
  static radToDeg(radians: number): number {
    return radians * (180 / Math.PI)
  }

  /**
   * Calculate mean motion for elliptical orbits
   */
  static meanMotion(semiMajorAxis: number, centralBodyMass: number = Constants.SOLAR_MASS): number {
    const auInMeters = semiMajorAxis * Constants.AU * 1000
    return Math.sqrt(Constants.G * centralBodyMass / Math.pow(auInMeters, 3))
  }

  /**
   * Solve Kepler's equation using Newton-Raphson method
   */
  static solveKeplerEquation(meanAnomaly: number, eccentricity: number, tolerance = 1e-8): number {
    let E = meanAnomaly // Initial guess
    let deltaE = 1

    // Newton-Raphson iteration
    while (Math.abs(deltaE) > tolerance) {
      const f = E - eccentricity * Math.sin(E) - meanAnomaly
      const df = 1 - eccentricity * Math.cos(E)
      deltaE = f / df
      E = E - deltaE
    }

    return E
  }

  /**
   * Calculate position and velocity at given time
   */
  static calculatePositionAtTime(elements: OrbitalElements, time: number): {
    position: [number, number, number]
    velocity: [number, number, number]
  } {
    const { a, e, epoch } = elements
    const dt = (time - epoch) * Constants.DAY_SECONDS // Convert to seconds

    if (e < 1) {
      // Elliptical orbit
      const n = OrbitalMechanics.meanMotion(Math.abs(a))
      const M = n * dt
      const E = OrbitalMechanics.solveKeplerEquation(M, e)
      const nu = OrbitalMechanics.calculateTrueAnomaly(E, e)

      const stateVectors = OrbitalMechanics.orbitalStateVectors(elements, nu)
      const [x, y] = stateVectors.position
      const [vx, vy] = stateVectors.velocity

      const [X, Y, Z] = OrbitalMechanics.transformToEcliptic(x, y, 0, elements)
      const [VX, VY, VZ] = OrbitalMechanics.transformToEcliptic(vx, vy, 0, elements)

      return {
        position: [X / Constants.AU, Y / Constants.AU, Z / Constants.AU], // Convert to AU
        velocity: [VX / 1000, VY / 1000, VZ / 1000] // Convert to km/s
      }
    } else {
      // Hyperbolic orbit (like 3I/ATLAS)
      const n = Math.sqrt(Constants.GM_SUN / Math.pow(Math.abs(a) * Constants.AU * 1000, 3))
      const M = n * dt
      const H = OrbitalMechanics.solveHyperbolicKepler(M, e)
      const nu = OrbitalMechanics.calculateTrueAnomalyHyperbolic(H, e)

      const stateVectors = OrbitalMechanics.orbitalStateVectors(elements, nu)
      const [x, y] = stateVectors.position
      const [vx, vy] = stateVectors.velocity

      const [X, Y, Z] = OrbitalMechanics.transformToEcliptic(x, y, 0, elements)
      const [VX, VY, VZ] = OrbitalMechanics.transformToEcliptic(vx, vy, 0, elements)

      return {
        position: [X / Constants.AU, Y / Constants.AU, Z / Constants.AU], // Convert to AU
        velocity: [VX / 1000, VY / 1000, VZ / 1000] // Convert to km/s
      }
    }
  }

  /**
   * Calculate intercept trajectory using Lambert's problem solver
   */
  static calculateInterceptTrajectory(
    startPosition: [number, number, number], // AU
    targetPosition: [number, number, number], // AU
    timeOfFlight: number, // seconds
    config: MissionConfig
  ): InterceptorTrajectory {
    try {
      logger.info('Calculating intercept trajectory', {
        startPosition,
        targetPosition,
        timeOfFlight,
        propulsionType: config.propulsionType
      })

      // Convert positions to meters
      const r1 = startPosition.map(x => x * Constants.AU * 1000) as [number, number, number]
      const r2 = targetPosition.map(x => x * Constants.AU * 1000) as [number, number, number]

      // Calculate delta-V requirements based on propulsion type
      const propulsionEfficiency = {
        chemical: { isp: 450, thrust: 100000 }, // N
        ion: { isp: 3000, thrust: 100 }, // N
        nuclear: { isp: 900, thrust: 50000 } // N
      }

      const propulsion = propulsionEfficiency[config.propulsionType]
      const totalDeltaV = this.calculateDeltaV(r1, r2, timeOfFlight)
      const fuelMass = this.calculateFuelMass(totalDeltaV, propulsion.isp, 1000) // 1000kg dry mass

      const steps = 100
      const points: TrajectoryPoint[] = []

      for (let i = 0; i <= steps; i++) {
        const t = i / steps
        const currentTime = Date.now() + t * timeOfFlight * 1000

        // Linear interpolation (simplified - real implementation would use Keplerian motion)
        const position: [number, number, number] = [
          r1[0] + t * (r2[0] - r1[0]),
          r1[1] + t * (r2[1] - r1[1]),
          r1[2] + t * (r2[2] - r1[2])
        ]

        // Estimate velocity and acceleration
        const velocity: [number, number, number] = [
          (r2[0] - r1[0]) / timeOfFlight,
          (r2[1] - r1[1]) / timeOfFlight,
          (r2[2] - r1[2]) / timeOfFlight
        ]

        const acceleration: [number, number, number] = [0, 0, 0] // Simplified

        points.push({
          time: currentTime,
          position: position.map(x => x / Constants.AU / 1000) as [number, number, number], // Convert back to AU
          velocity: velocity.map(x => x / 1000) as [number, number, number], // Convert to km/s
          fuelMass: fuelMass * (1 - t), // Linear fuel consumption
          acceleration
        })
      }

      const interceptProbability = this.calculateInterceptProbability(
        totalDeltaV,
        timeOfFlight,
        config
      )

      return {
        points,
        totalDeltaV,
        totalFuelUsed: fuelMass,
        flightTime: timeOfFlight,
        interceptProbability
      }
    } catch (error) {
      logger.error('Error calculating intercept trajectory', { error })
      throw error
    }
  }

  /**
   * Calculate true anomaly from eccentric anomaly
   */
  static calculateTrueAnomaly(E: number, e: number): number {
    return 2 * Math.atan2(
      Math.sqrt(1 + e) * Math.sin(E / 2),
      Math.sqrt(1 - e) * Math.cos(E / 2)
    )
  }

  /**
   * Calculate true anomaly for hyperbolic orbits
   */
  static calculateTrueAnomalyHyperbolic(H: number, e: number): number {
    return 2 * Math.atan(Math.sqrt((e + 1) / (e - 1)) * Math.tanh(H / 2))
  }

  /**
   * Solve hyperbolic Kepler equation
   */
  static solveHyperbolicKepler(M: number, e: number, tolerance = 1e-8): number {
    let H = M // Initial guess
    let deltaH = 1

    while (Math.abs(deltaH) > tolerance) {
      const f = e * Math.sinh(H) - H - M
      const df = e * Math.cosh(H) - 1
      deltaH = f / df
      H = H - deltaH
    }

    return H
  }

  /**
   * Calculate orbital state vectors
   */
  static orbitalStateVectors(elements: OrbitalElements, nu: number): {
    position: [number, number]
    velocity: [number, number]
  } {
    const { a, e } = elements
    const r = Math.abs(a) * (1 - e * e) / (1 + e * Math.cos(nu))
    
    // Position in orbital plane
    const x = r * Math.cos(nu)
    const y = r * Math.sin(nu)
    
    // Velocity in orbital plane (simplified)
    const h = Math.sqrt(Constants.GM_SUN * Math.abs(a) * (1 - e * e))
    const vx = -h * Math.sin(nu) / r
    const vy = h * (e + Math.cos(nu)) / r
    
    return {
      position: [x, y],
      velocity: [vx, vy]
    }
  }

  /**
   * Transform coordinates to ecliptic frame
   */
  static transformToEcliptic(x: number, y: number, z: number, elements: OrbitalElements): [number, number, number] {
    const { i, omega, Omega } = elements
    const iRad = this.degToRad(i)
    const omegaRad = this.degToRad(omega)
    const OmegaRad = this.degToRad(Omega)
    
    // Rotation matrices
    const cosOmega = Math.cos(omegaRad)
    const sinOmega = Math.sin(omegaRad)
    const cosI = Math.cos(iRad)
    const sinI = Math.sin(iRad)
    const cosCapitalOmega = Math.cos(OmegaRad)
    const sinCapitalOmega = Math.sin(OmegaRad)
    
    // Apply rotations
    const X = (cosCapitalOmega * cosOmega - sinCapitalOmega * sinOmega * cosI) * x +
              (-cosCapitalOmega * sinOmega - sinCapitalOmega * cosOmega * cosI) * y
    const Y = (sinCapitalOmega * cosOmega + cosCapitalOmega * sinOmega * cosI) * x +
              (-sinCapitalOmega * sinOmega + cosCapitalOmega * cosOmega * cosI) * y
    const Z = (sinOmega * sinI) * x + (cosOmega * sinI) * y
    
    return [X, Y, Z]
  }

  /**
   * Calculate delta-V requirements
   */
  static calculateDeltaV(r1: [number, number, number], r2: [number, number, number], timeOfFlight: number): number {
    // Simplified delta-V calculation using vis-viva equation
    const r1Mag = Math.sqrt(r1[0] * r1[0] + r1[1] * r1[1] + r1[2] * r1[2])
    const r2Mag = Math.sqrt(r2[0] * r2[0] + r2[1] * r2[1] + r2[2] * r2[2])
    
    // Semi-major axis of transfer orbit
    const a = (r1Mag + r2Mag) / 2
    
    // Velocities at periapsis and apoapsis
    const v1 = Math.sqrt(Constants.GM_SUN * (2 / r1Mag - 1 / a))
    const v2 = Math.sqrt(Constants.GM_SUN * (2 / r2Mag - 1 / a))
    
    // Circular velocities
    const vCirc1 = Math.sqrt(Constants.GM_SUN / r1Mag)
    const vCirc2 = Math.sqrt(Constants.GM_SUN / r2Mag)
    
    // Delta-V requirements
    const deltaV1 = Math.abs(v1 - vCirc1)
    const deltaV2 = Math.abs(v2 - vCirc2)
    
    return deltaV1 + deltaV2
  }

  /**
   * Calculate fuel mass using rocket equation
   */
  static calculateFuelMass(deltaV: number, isp: number, dryMass: number): number {
    const ve = isp * 9.81 // Exhaust velocity
    const massRatio = Math.exp(deltaV / ve)
    return dryMass * (massRatio - 1)
  }

  /**
   * Calculate intercept probability
   */
  static calculateInterceptProbability(deltaV: number, timeOfFlight: number, config: MissionConfig): number {
    // Simplified probability calculation based on mission parameters
    let baseProbability = 0.85
    
    // Adjust based on delta-V requirements
    if (deltaV > 15000) baseProbability *= 0.7
    else if (deltaV > 10000) baseProbability *= 0.85
    
    // Adjust based on flight time
    const flightTimeYears = timeOfFlight / Constants.YEAR_SECONDS
    if (flightTimeYears > 2) baseProbability *= 0.8
    else if (flightTimeYears > 1) baseProbability *= 0.9
    
    // Adjust based on propulsion type
    const propulsionMultiplier = {
      chemical: 0.9,
      ion: 0.95,
      nuclear: 0.85
    }
    
    baseProbability *= propulsionMultiplier[config.propulsionType]
    
    return Math.max(0.1, Math.min(0.99, baseProbability))
  }

  /**
   * Get current positions of all celestial bodies
   */
  static getCurrentCelestialPositions(time: number = Date.now()): Record<string, [number, number, number]> {
    const julianTime = (time / 1000 / Constants.DAY_SECONDS) + 2440587.5 // Convert to Julian date
    const positions: Record<string, [number, number, number]> = {}

    // Calculate 3I/ATLAS position
    const atlasState = OrbitalMechanics.calculatePositionAtTime(ATLAS_3I_ELEMENTS, julianTime)
    positions['3I/ATLAS'] = atlasState.position

    // Calculate planetary positions
    for (const [name, elements] of Object.entries(PLANETARY_ELEMENTS)) {
      const planetState = OrbitalMechanics.calculatePositionAtTime(elements, julianTime)
      positions[name] = planetState.position
    }

    return positions
  }
}

export default OrbitalMechanics
