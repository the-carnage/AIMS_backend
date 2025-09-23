# AIMS Backend - Atlas Interceptor Mission Simulator

A Node.js + TypeScript + Express.js backend API for the AIMS space mission simulator, featuring orbital mechanics calculations, NASA API integration, and real-time WebSocket communications.

## Features

- **RESTful API** with comprehensive endpoints for mission planning and celestial data
- **Real-time WebSocket communication** using Socket.io for live mission updates
- **Orbital mechanics calculations** with accurate physics simulations
- **NASA API integration** for real astronomical data from JPL Horizons and other NASA services
- **Mission trajectory optimization** using Lambert's problem and delta-V calculations
- **Rate limiting and security** with comprehensive error handling
- **Comprehensive logging** with Winston for debugging and monitoring
- **Type-safe development** with TypeScript throughout

## Setup Instructions

### Prerequisites
- Node.js 18.0.0 or later
- npm 8.0.0 or later
- NASA API key (optional, uses DEMO_KEY by default)

### Installation

1. **Extract the backend.zip file:**
   ```bash
   unzip backend.zip
   cd aims-backend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up environment variables:**
   ```bash
   cp .env.example .env
   ```

4. **Start development server:**
   ```bash
   npm run dev
   ```

The API will be available at `http://localhost:3001`

## Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Compile TypeScript to JavaScript
- `npm start` - Start production server
- `npm run lint` - Run ESLint for code quality

## API Endpoints

### Health Check
- `GET /api/health` - Basic health check
- `GET /api/health/detailed` - Detailed system information

### Mission Planning
- `POST /api/mission/calculate` - Calculate mission trajectory
- `POST /api/mission/validate` - Validate mission configuration  

### Celestial Bodies
- `GET /api/celestial/bodies` - Get all celestial bodies
- `GET /api/celestial/atlas` - Get 3I/ATLAS specific data
- `GET /api/celestial/positions` - Get current positions

### NASA API Proxy
- `GET /api/nasa/horizons` - JPL Horizons ephemeris data
- `GET /api/nasa/apod` - Astronomy Picture of the Day

### Simulation Control
- `POST /api/simulation/start` - Start new simulation
- `POST /api/simulation/pause` - Pause simulation
- `GET /api/simulation/:id` - Get simulation status

## License

Created for the AIMS hackathon project, following open-source principles.
