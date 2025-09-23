import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible'
import { Request, Response, NextFunction } from 'express'
import { logger } from '../utils/logger.js'

// Configuration
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000') // 15 minutes
const RATE_LIMIT_MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100')

// Create rate limiter instance
const rateLimiter = new RateLimiterMemory({
  keyPrefix: 'aims-api',
  points: RATE_LIMIT_MAX_REQUESTS, // Number of requests
  duration: Math.floor(RATE_LIMIT_WINDOW_MS / 1000), // Per duration in seconds
  blockDuration: Math.floor(RATE_LIMIT_WINDOW_MS / 1000), // Block for duration if limit exceeded
})

// Stricter rate limiting for compute-intensive endpoints
const computeRateLimiter = new RateLimiterMemory({
  keyPrefix: 'aims-compute',
  points: 10, // Lower limit for computation endpoints
  duration: 60, // Per minute
  blockDuration: 60,
})

// Rate limiter middleware
export const rateLimiterMiddleware = async (
  req: Request, 
  res: Response, 
  next: NextFunction
): Promise<void> => {
  try {
    // Get client identifier (IP or authenticated user ID)
    const key = req.ip || 'unknown'

    // Choose appropriate limiter based on endpoint
    const isComputeEndpoint = req.path.includes('/calculate') || 
                              req.path.includes('/simulation') ||
                              req.path.includes('/trajectory')

    const limiter = isComputeEndpoint ? computeRateLimiter : rateLimiter

    await limiter.consume(key)

    // Add rate limit headers
    const resRateLimiter = await limiter.get(key)
    if (resRateLimiter) {
      res.set({
        'X-RateLimit-Limit': limiter.points.toString(),
        'X-RateLimit-Remaining': resRateLimiter.remainingPoints.toString(),
        'X-RateLimit-Reset': new Date(Date.now() + resRateLimiter.msBeforeNext).toISOString(),
      })
    }

    next()
  } catch (rejRes) {
    if (rejRes instanceof RateLimiterRes) {
      logger.warn('Rate limit exceeded', {
        ip: req.ip,
        path: req.path,
        remainingPoints: rejRes.remainingPoints || 0,
        msBeforeNext: rejRes.msBeforeNext || 0,
      })

      const secs = Math.round(rejRes.msBeforeNext / 1000) || 1

      res.set({
        'Retry-After': String(secs),
        'X-RateLimit-Limit': rateLimiter.points.toString(),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': new Date(Date.now() + rejRes.msBeforeNext).toISOString(),
      })

      res.status(429).json({
        success: false,
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Please try again in ${secs} seconds.`,
        timestamp: Date.now(),
        retryAfter: secs,
      })
    } else {
      logger.error('Rate limiter error', { error: rejRes })
      next() // Continue if rate limiter fails
    }
  }
}

// Export both the middleware and the limiter instance
export { rateLimiterMiddleware as rateLimiter, rateLimiter as rateLimiterInstance }
