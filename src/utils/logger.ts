import winston from 'winston'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Custom log format
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.prettyPrint()
)

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({
    format: 'HH:mm:ss'
  }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let metaString = ''
    if (Object.keys(meta).length > 0) {
      metaString = JSON.stringify(meta, null, 2)
    }
    return `${timestamp} [${level}]: ${message} ${metaString}`
  })
)

// Create logger
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'aims-backend' },
  transports: [
    // Console transport
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'development' ? consoleFormat : logFormat
    }),

    // File transports
    new winston.transports.File({
      filename: process.env.LOG_FILE || path.join(__dirname, '../../logs/error.log'),
      level: 'error'
    }),
    new winston.transports.File({
      filename: process.env.LOG_FILE || path.join(__dirname, '../../logs/combined.log')
    })
  ]
})

// Handle uncaught exceptions and unhandled rejections
logger.exceptions.handle(
  new winston.transports.File({
    filename: path.join(__dirname, '../../logs/exceptions.log')
  })
)

logger.rejections.handle(
  new winston.transports.File({
    filename: path.join(__dirname, '../../logs/rejections.log')
  })
)

export default logger
