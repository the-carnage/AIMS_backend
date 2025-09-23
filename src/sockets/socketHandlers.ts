import { Server, Socket } from 'socket.io'
import { logger } from '../utils/logger.js'
import { MissionConfig, SocketEvents } from '../types/index.js'
import OrbitalMechanics, { PLANETARY_ELEMENTS, ATLAS_3I_ELEMENTS } from '../services/orbitalMechanics.js'

export function setupSocketHandlers(io: Server): void {
  // Store connected clients and their subscriptions
  const connectedClients = new Map<string, any>()
  const simulationSubscriptions = new Map<string, Set<string>>()

  io.on('connection', (socket) => {
    logger.info('Client connected', { 
      socketId: socket.id, 
      clientIp: socket.handshake.address 
    })

    connectedClients.set(socket.id, {
      connectedAt: Date.now(),
      subscriptions: new Set<string>()
    })
    
    // Track position update subscribers
    const positionSubscribers = new Set<string>()
    let positionUpdateInterval: NodeJS.Timeout | null = null
    
    // Handle position update subscription
    socket.on('subscribe_position_updates', () => {
      logger.info(`Client ${socket.id} subscribed to position updates`)
      positionSubscribers.add(socket.id)
      
      // Start position updates if this is the first subscriber
      if (positionSubscribers.size === 1) {
        startPositionUpdates()
      }
    })
    
    // Handle position update unsubscription
    socket.on('unsubscribe_position_updates', () => {
      logger.info(`Client ${socket.id} unsubscribed from position updates`)
      positionSubscribers.delete(socket.id)
      
      // Stop position updates if no more subscribers
      if (positionSubscribers.size === 0 && positionUpdateInterval) {
        clearInterval(positionUpdateInterval)
        positionUpdateInterval = null
      }
    })
    
    // Function to start sending position updates
    const startPositionUpdates = () => {
      // Clear any existing interval
      if (positionUpdateInterval) {
        clearInterval(positionUpdateInterval)
      }
      
      // Send initial position data
      sendPositionUpdate()
      
      // Set up interval for regular updates (every 1 second)
      positionUpdateInterval = setInterval(sendPositionUpdate, 1000)
    }
    
    // Function to send position updates to subscribers
    const sendPositionUpdate = () => {
      try {
        const currentTime = Date.now()
        // Use shared helper to ensure correct time base and units
        const positions = OrbitalMechanics.getCurrentCelestialPositions(currentTime)

        if (positionSubscribers.size > 0) {
          socket.emit('position_update', positions)
          socket.emit('data_source_change', 'calculated_fallback')
        }
      } catch (error) {
        logger.error('Error sending position updates:', error)
      }
    }

    // Handle client requesting to join a simulation
    socket.on('join-simulation', (data: { simulationId: string }) => {
      const { simulationId } = data

      logger.info('Client joining simulation', { 
        socketId: socket.id, 
        simulationId 
      })

      // Join socket room
      socket.join(`simulation:${simulationId}`)

      // Track subscription
      const client = connectedClients.get(socket.id)
      if (client) {
        client.subscriptions.add(simulationId)
      }

      if (!simulationSubscriptions.has(simulationId)) {
        simulationSubscriptions.set(simulationId, new Set())
      }
      simulationSubscriptions.get(simulationId)?.add(socket.id)

      // Send initial data
      socket.emit('simulation-joined', {
        simulationId,
        message: 'Successfully joined simulation',
        timestamp: Date.now()
      })
    })
    
    // Handle real-time position subscription
    socket.on('subscribe-positions', () => {
      logger.info('Client subscribed to real-time positions', { socketId: socket.id })
      
      // Send initial positions immediately
      const initialPositions = OrbitalMechanics.getCurrentCelestialPositions()
      socket.emit('position-update', {
        positions: initialPositions,
        dataSource: 'calculated', // Initial data is calculated
        timestamp: Date.now()
      })
      
      // Set up interval for regular updates
      const updateInterval = setInterval(() => {
        try {
          // Try to get positions from NASA API first
          // This is a placeholder - in a real implementation, you would call the NASA API
          // For now, we'll use the calculated positions
          const positions = OrbitalMechanics.getCurrentCelestialPositions()
          
          // Determine if we're using live or calculated data
          // In a real implementation, this would be based on the API response
          const dataSource = Math.random() > 0.5 ? 'live' : 'calculated'
          
          socket.emit('position-update', {
            positions,
            dataSource,
            timestamp: Date.now()
          })
        } catch (error) {
          logger.error('Error sending position update', {
            socketId: socket.id,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }, 2000) // Update every 2 seconds
      
      // Clean up interval on disconnect
      socket.on('disconnect', () => {
        clearInterval(updateInterval)
      })
    })

    // Handle mission configuration updates
    socket.on('update-mission-config', (config: MissionConfig) => {
      logger.debug('Mission config update received', { 
        socketId: socket.id, 
        config 
      })

      try {
        // Validate and process mission config
        const launchTime = new Date(config.launchWindow).getTime()

        // Get current celestial positions
        const positions = OrbitalMechanics.getCurrentCelestialPositions(launchTime)

        // Calculate trajectory
        const earthPosition = positions['Earth']
        const atlasPosition = positions['3I/ATLAS']

        if (earthPosition && atlasPosition) {
          const trajectory = OrbitalMechanics.calculateInterceptTrajectory(
            earthPosition,
            atlasPosition,
            365 * 24 * 60 * 60, // 1 year
            config
          )

          // Send trajectory update back to client
          socket.emit('trajectory-calculated', {
            config,
            trajectory,
            positions,
            timestamp: Date.now()
          })
        }
      } catch (error) {
        logger.error('Error processing mission config', { 
          socketId: socket.id, 
          error: error instanceof Error ? error.message : String(error)
        })

        socket.emit('mission-alert', {
          type: 'error',
          message: 'Failed to process mission configuration',
          timestamp: Date.now()
        })
      }
    })

    // Handle request for real-time celestial positions
    socket.on('request-positions', (data: { time?: number }) => {
      const time = data?.time || Date.now()

      try {
        const positions = OrbitalMechanics.getCurrentCelestialPositions(time)

        socket.emit('positions-update', {
          time,
          positions,
          timestamp: Date.now()
        })
      } catch (error) {
        logger.error('Error fetching positions', { 
          socketId: socket.id, 
          error: error instanceof Error ? error.message : String(error)
        })

        socket.emit('mission-alert', {
          type: 'error',
          message: 'Failed to fetch celestial positions',
          timestamp: Date.now()
        })
      }
    })

    // Handle ping/pong for connection testing
    socket.on('ping', (data) => {
      socket.emit('pong', { 
        ...data, 
        serverTime: Date.now() 
      })
    })

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      logger.info('Client disconnected', { 
        socketId: socket.id, 
        reason 
      })

      // Clean up subscriptions
      const client = connectedClients.get(socket.id)
      if (client) {
        for (const simulationId of client.subscriptions) {
          simulationSubscriptions.get(simulationId)?.delete(socket.id)
        }
      }

      connectedClients.delete(socket.id)
    })

    // Send welcome message
    socket.emit('connected', {
      message: 'Connected to AIMS Mission Control',
      socketId: socket.id,
      timestamp: Date.now()
    })
  })

  // Broadcast system updates every 10 seconds
  setInterval(() => {
    const currentTime = Date.now()
    const positions = OrbitalMechanics.getCurrentCelestialPositions(currentTime)

    io.emit('simulation-tick', {
      time: currentTime,
      positions,
      clientCount: connectedClients.size
    })
  }, 10000)

  // Store IO instance globally for access from other modules
  ;(global as any).io = io

  logger.info('Socket.IO handlers initialized', {
    transports: io.engine.opts.transports,
    cors: io.engine.opts.cors
  })
}

export default setupSocketHandlers
