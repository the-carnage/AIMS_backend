import { Request, Response, NextFunction } from 'express'
import { logger } from '../utils/logger.js'

interface RequestLogData {
  method: string
  url: string
  ip: string
  userAgent?: string
  requestId?: string
  responseTime?: number
  statusCode?: number
  contentLength?: string
}

// Generate unique request ID
const generateRequestId = (): string => {
  return Math.random().toString(36).substr(2, 9)
}

// Request logger middleware
export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now()
  const requestId = generateRequestId()

  // Add request ID to request object for use in other middleware
  ;(req as any).requestId = requestId

  // Prepare log data
  const logData: RequestLogData = {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip || req.connection.remoteAddress || 'unknown',
    userAgent: req.get('User-Agent'),
    requestId,
  }

  // Log incoming request
  logger.info('Incoming request', {
    ...logData,
    body: req.method === 'POST' || req.method === 'PUT' ? req.body : undefined,
    query: Object.keys(req.query).length > 0 ? req.query : undefined,
  })

  // Override res.end to log response
  const originalEnd = res.end
  res.end = function(chunk: any, encoding?: any): any {
    const responseTime = Date.now() - startTime

    // Complete log data
    const completeLogData: RequestLogData = {
      ...logData,
      responseTime,
      statusCode: res.statusCode,
      contentLength: res.get('content-length'),
    }

    // Determine log level based on status code
    if (res.statusCode >= 500) {
      logger.error('Request completed with error', completeLogData)
    } else if (res.statusCode >= 400) {
      logger.warn('Request completed with client error', completeLogData)
    } else if (responseTime > 5000) {
      logger.warn('Slow request completed', completeLogData)
    } else {
      logger.info('Request completed', completeLogData)
    }

    // Call original end method
    originalEnd.call(this, chunk, encoding)
  }

  next()
}
