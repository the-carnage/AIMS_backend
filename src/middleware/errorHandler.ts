import { Request, Response, NextFunction } from 'express'
import { logger } from '../utils/logger.js'
import { ApiError, ApiResponse } from '../types/index.js'

export class AppError extends Error implements ApiError {
  statusCode: number
  isOperational: boolean

  constructor(message: string, statusCode: number, isOperational = true) {
    super(message)
    this.statusCode = statusCode
    this.isOperational = isOperational
    this.name = this.constructor.name

    Error.captureStackTrace(this, this.constructor)
  }
}

// Create specific error types
export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400)
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found') {
    super(message, 404)
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized access') {
    super(message, 401)
  }
}

export class InternalServerError extends AppError {
  constructor(message: string = 'Internal server error') {
    super(message, 500)
  }
}

// Format error response
const formatErrorResponse = (error: Error, statusCode: number): ApiResponse => {
  const isDevelopment = process.env.NODE_ENV === 'development'

  return {
    success: false,
    error: error.message,
    message: `Error ${statusCode}: ${error.message}`,
    timestamp: Date.now(),
    ...(isDevelopment && { stack: error.stack })
  }
}

// Main error handler middleware
export const errorHandler = (
  error: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Default to 500 internal server error
  let statusCode = 500
  let isOperational = false

  if (error instanceof AppError) {
    statusCode = error.statusCode
    isOperational = error.isOperational
  }

  // Log error details
  logger.error('Error occurred', {
    error: error.message,
    stack: error.stack,
    statusCode,
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    isOperational
  })

  // Don't expose internal errors in production
  if (!isOperational && process.env.NODE_ENV === 'production') {
    statusCode = 500
    error.message = 'Something went wrong'
  }

  const errorResponse = formatErrorResponse(error, statusCode)
  res.status(statusCode).json(errorResponse)
}

// Async error wrapper
export const catchAsync = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

// 404 handler for undefined routes
export const notFoundHandler = (req: Request, res: Response, next: NextFunction): void => {
  const error = new NotFoundError(`Route ${req.originalUrl} not found`)
  next(error)
}
