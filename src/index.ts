import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import { createServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
import dotenv from 'dotenv'

import { logger } from './utils/logger.js'
import { errorHandler } from './middleware/errorHandler.js'
import { rateLimiter } from './middleware/rateLimiter.js'
import { requestLogger } from './middleware/requestLogger.js'

// Route imports
import healthRoutes from './routes/health.js'
import missionRoutes from './routes/mission.js'
import celestialRoutes from './routes/celestial.js'
import nasaRoutes from './routes/nasa.js'
import simulationRoutes from './routes/simulation.js'

// Socket handlers
import { setupSocketHandlers } from './sockets/socketHandlers.js'

// Load environment variables
dotenv.config()

const PORT = process.env.PORT || 3001
const HOST = process.env.HOST || 'localhost'
const NODE_ENV = process.env.NODE_ENV || 'development'

// Create Express app
const app = express()
const httpServer = createServer(app)

// Socket.IO setup
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.SOCKET_IO_CORS_ORIGIN || "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
})

// Middleware setup
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}))

app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:5173', 'http://localhost:3000'],
  credentials: process.env.CORS_CREDENTIALS === 'true',
}))

app.use(compression())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Apply rate limiting
app.use(rateLimiter)

// Request logging
app.use(requestLogger)

// API Routes
app.use('/api/health', healthRoutes)
app.use('/api/mission', missionRoutes)
app.use('/api/celestial', celestialRoutes)
app.use('/api/nasa', nasaRoutes)
app.use('/api/simulation', simulationRoutes)

// API Documentation
if (NODE_ENV === 'development') {
  app.get('/api/docs', (req, res) => {
    res.json({
      message: 'AIMS API Documentation',
      version: '1.0.0',
      endpoints: {
        health: '/api/health',
        mission: '/api/mission/*',
        celestial: '/api/celestial/*',
        nasa: '/api/nasa/*',
        simulation: '/api/simulation/*'
      },
      socketEvents: {
        'mission-update': 'Real-time mission status updates',
        'simulation-tick': 'Simulation time updates',
        'mission-alert': 'Mission alerts and warnings'
      }
    })
  })
}

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'AIMS Backend - Atlas Interceptor Mission Simulator',
    version: '1.0.0',
    status: 'operational',
    timestamp: new Date().toISOString(),
    docs: NODE_ENV === 'development' ? '/api/docs' : undefined
  })
})

// Setup Socket.IO handlers
setupSocketHandlers(io)

// Error handling middleware (must be last)
app.use(errorHandler)

// Start server
httpServer.listen(Number(PORT), HOST, () => {
  logger.info(`AIMS Backend server started`, {
    port: PORT,
    host: HOST,
    environment: NODE_ENV,
    socketIO: true
  })
})

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully')
  httpServer.close(() => {
    logger.info('Process terminated')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully')
  httpServer.close(() => {
    logger.info('Process terminated')
    process.exit(0)
  })
})

// Export for testing
export { app, io, httpServer }
