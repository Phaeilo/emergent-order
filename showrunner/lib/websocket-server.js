import { WebSocketServer as WSServer } from 'ws';
import { EventEmitter } from 'events';

/**
 * WebSocket Server for LED Cube Remote Control
 * Provides exclusive access to serial port via WebSocket connection
 * Supports raw binary serial command forwarding
 */
export class WebSocketServer extends EventEmitter {
  constructor(config, serialConn, animationEngine) {
    super();
    this.config = config;
    this.serialConn = serialConn;
    this.animationEngine = animationEngine;

    this.wss = null;
    this.activeClient = null;
    this.activeClientConnectTime = null;
    this.idleTimer = null;
  }

  /**
   * Start WebSocket server
   */
  async start() {
    return new Promise((resolve, reject) => {
      const { wsListenHost, wsListenPort } = this.config;

      this.wss = new WSServer({
        host: wsListenHost,
        port: wsListenPort,
        path: '/ws'
      });

      this.wss.on('connection', (ws, req) => {
        this.handleConnection(ws, req);
      });

      this.wss.on('error', (error) => {
        console.error('WebSocket server error:', error.message);
        this.emit('error', error);
        reject(error);
      });

      this.wss.on('listening', () => {
        console.log(`WebSocket server listening on ws://${wsListenHost}:${wsListenPort}/ws`);
        this.emit('ready');
        resolve();
      });
    });
  }

  /**
   * Handle new WebSocket connection
   * Implements exclusive access with age-based eviction
   */
  handleConnection(ws, req) {
    const clientIp = req.socket.remoteAddress;
    console.log(`WebSocket connection attempt from ${clientIp}`);

    // Check if we have an active connection
    if (this.activeClient) {
      const connectionAge = (Date.now() - this.activeClientConnectTime) / 1000;

      if (connectionAge >= this.config.wsEvictionAge) {
        // Evict old connection
        console.log(`Evicting connection (age: ${connectionAge.toFixed(1)}s)`);
        this.sendError(this.activeClient, {
          error: 'Connection evicted by new client',
          code: 'EVICTED',
          timestamp: new Date().toISOString()
        });
        this.activeClient.close();

        // Accept new connection
        this.acceptConnection(ws, clientIp);
      } else {
        // Reject new connection
        const retryAfter = Math.ceil(this.config.wsEvictionAge - connectionAge);
        console.log(`Rejecting connection - server busy (retry after ${retryAfter}s)`);
        this.sendError(ws, {
          error: 'Server busy - exclusive connection in use',
          code: 'SERVER_BUSY',
          timestamp: new Date().toISOString(),
          retryAfter
        });
        ws.close();
      }
    } else {
      // No active connection, accept immediately
      this.acceptConnection(ws, clientIp);
    }
  }

  /**
   * Accept a WebSocket connection and set up handlers
   */
  acceptConnection(ws, clientIp) {
    console.log(`Accepting WebSocket connection from ${clientIp}`);

    // Set active client
    this.activeClient = ws;
    this.activeClientConnectTime = Date.now();

    // Pause animation engine
    this.animationEngine.pause();

    // Setup event handlers
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        this.handleClientData(data, ws);
      } else {
        console.warn('Received non-binary data, ignoring');
      }
    });

    ws.on('close', () => {
      this.handleClientClose(ws);
    });

    ws.on('error', (error) => {
      this.handleClientError(error, ws);
    });

    // Start idle timeout
    this.resetIdleTimer();

    this.emit('client-connected', clientIp);
  }

  /**
   * Handle binary data from WebSocket client
   * Forwards raw binary commands to serial port
   */
  handleClientData(data, ws) {
    if (ws !== this.activeClient) {
      console.warn('Received data from non-active client, ignoring');
      return;
    }

    // Reset idle timer
    this.resetIdleTimer();

    // Forward to serial
    try {
      this.serialConn.write(data);

      if (this.config.logLevel === 'debug') {
        console.log(`Forwarded ${data.length} bytes to serial`);
      }
    } catch (err) {
      console.error('Error writing to serial:', err.message);
      this.sendError(ws, {
        error: 'Failed to forward command to serial port',
        code: 'SERIAL_ERROR',
        timestamp: new Date().toISOString(),
        details: err.message
      });
    }
  }

  /**
   * Handle WebSocket client disconnect
   */
  handleClientClose(ws) {
    if (ws !== this.activeClient) {
      return;
    }

    console.log('WebSocket client disconnected');

    // Clear idle timer
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    // Clear active client
    this.activeClient = null;
    this.activeClientConnectTime = null;

    // Resume animation engine
    this.animationEngine.resume();

    this.emit('client-disconnected');
  }

  /**
   * Handle WebSocket client error
   */
  handleClientError(error, ws) {
    console.error('WebSocket client error:', error.message);
    this.handleClientClose(ws);
  }

  /**
   * Reset idle timeout timer
   * Closes connection after configured idle timeout
   */
  resetIdleTimer() {
    // Clear existing timer
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    // Set new timer
    this.idleTimer = setTimeout(() => {
      console.log('Idle timeout - closing connection');

      if (this.activeClient) {
        this.sendError(this.activeClient, {
          error: `Idle timeout - no commands received for ${this.config.wsIdleTimeout} seconds`,
          code: 'IDLE_TIMEOUT',
          timestamp: new Date().toISOString()
        });
        this.activeClient.close();
      }
    }, this.config.wsIdleTimeout * 1000);
  }

  /**
   * Send error message to WebSocket client as JSON
   */
  sendError(ws, errorObj) {
    try {
      const message = JSON.stringify(errorObj);
      ws.send(message);
    } catch (err) {
      console.error('Failed to send error message:', err.message);
    }
  }

  /**
   * Stop WebSocket server and close all connections
   */
  async stop() {
    console.log('Stopping WebSocket server');

    // Close active connection
    if (this.activeClient) {
      this.sendError(this.activeClient, {
        error: 'Server shutting down',
        code: 'SHUTDOWN',
        timestamp: new Date().toISOString()
      });
      this.activeClient.close();
    }

    // Clear timers
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    // Close server
    if (this.wss) {
      await new Promise((resolve) => {
        this.wss.close(resolve);
      });
    }

    console.log('WebSocket server stopped');
  }
}
