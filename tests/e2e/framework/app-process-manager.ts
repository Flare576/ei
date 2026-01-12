// Application Process Manager Implementation
// Manages the EI application as a controlled subprocess with input/output handling

import { spawn, ChildProcess } from 'child_process';
import { AppProcessManager, AppConfig } from '../types.js';
import * as pty from 'node-pty';

export class AppProcessManagerImpl implements AppProcessManager {
  private processes: Map<ChildProcess, ProcessInfo> = new Map();
  private ptyProcesses: Map<pty.IPty, PtyProcessInfo> = new Map();
  private outputBuffers: Map<ChildProcess | pty.IPty, string> = new Map();
  private timeoutHandlers: Map<ChildProcess | pty.IPty, NodeJS.Timeout> = new Map();

  /**
   * Starts the EI application as a controlled subprocess
   * Requirements: 2.1 - Launch EI application as background process
   */
  async start(config: AppConfig): Promise<ChildProcess> {
    // Use regular spawn by default, PTY only when explicitly requested
    if (config.usePty === true) {
      return this.startWithPty(config);
    } else {
      return this.startWithSpawn(config);
    }
  }

  /**
   * Starts the application using node-pty for better blessed app support
   */
  private async startWithPty(config: AppConfig): Promise<ChildProcess> {
    const args = ['dist/index.js'];
    
    // Add debug flag if enabled
    if (config.debugMode) {
      args.push('-d');
    }

    // Set up environment variables for the process
    const env = {
      ...process.env,
      EI_DATA_PATH: config.dataPath,
      EI_LLM_BASE_URL: config.llmBaseUrl,
      EI_LLM_API_KEY: config.llmApiKey,
      EI_LLM_MODEL: config.llmModel,
      // Enable test input injection
      EI_TEST_INPUT: 'true',
      // Enable test output capture
      EI_TEST_OUTPUT: 'true',
      // Disable colors for cleaner output parsing
      NO_COLOR: '1',
      // Set NODE_ENV to test to avoid production behaviors
      NODE_ENV: 'test'
    };

    // Use the same node executable that's running this process
    const nodeExecutable = process.execPath;
    
    const ptyProcess = pty.spawn(nodeExecutable, args, {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      env: env
    });

    // Create a wrapper ChildProcess-like object for compatibility
    const processWrapper = this.createPtyWrapper(ptyProcess);

    // Initialize process tracking
    const processInfo: PtyProcessInfo = {
      startTime: Date.now(),
      config,
      exitCode: null,
      exitPromise: null,
      ptyProcess: ptyProcess,
      timeouts: {
        initialization: 5000,
        gracefulShutdown: 3000,
        forceKill: 1000
      }
    };

    this.ptyProcesses.set(ptyProcess, processInfo);
    this.outputBuffers.set(ptyProcess, '');

    // Set up output capture
    this.setupPtyOutputCapture(ptyProcess);

    // Set up exit handling
    processInfo.exitPromise = this.setupPtyExitHandling(ptyProcess, processWrapper);

    // Set up automatic termination for hanging processes
    this.setupHangingProcessDetection(ptyProcess);

    // Verify initialization within timeout
    await this.verifyPtyInitialization(ptyProcess, processInfo.timeouts.initialization);

    return processWrapper;
  }

  /**
   * Starts the application using regular spawn (original method)
   */
  private async startWithSpawn(config: AppConfig): Promise<ChildProcess> {
    const args = ['dist/index.js'];
    
    // Add debug flag if enabled
    if (config.debugMode) {
      args.push('-d');
    }

    // Set up environment variables for the process
    const env = {
      ...process.env,
      EI_DATA_PATH: config.dataPath,
      EI_LLM_BASE_URL: config.llmBaseUrl,
      EI_LLM_API_KEY: config.llmApiKey,
      EI_LLM_MODEL: config.llmModel,
      // Enable test input injection
      EI_TEST_INPUT: 'true',
      // Enable test output capture
      EI_TEST_OUTPUT: 'true',
      // Disable colors for cleaner output parsing
      NO_COLOR: '1',
      // Set NODE_ENV to test to avoid production behaviors
      NODE_ENV: 'test'
    };

    const childProcess = spawn('node', args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd()
    });

    // Initialize process tracking
    const processInfo: ProcessInfo = {
      startTime: Date.now(),
      config,
      exitCode: null,
      exitPromise: null,
      timeouts: {
        initialization: 5000,
        gracefulShutdown: 3000,
        forceKill: 1000
      }
    };

    this.processes.set(childProcess, processInfo);
    this.outputBuffers.set(childProcess, '');

    // Set up output capture
    this.setupOutputCapture(childProcess);

    // Set up exit handling
    processInfo.exitPromise = this.setupExitHandling(childProcess);

    // Set up automatic termination for hanging processes
    this.setupHangingProcessDetection(childProcess);

    // Verify initialization within timeout
    await this.verifyInitialization(childProcess, processInfo.timeouts.initialization);

    return childProcess;
  }

  /**
   * Stops the application process gracefully or forcefully
   * Requirements: 2.4 - Capture exit code and final state
   * Requirements: 2.2, 2.5 - Configurable timeouts and automatic termination
   */
  async stop(process: ChildProcess): Promise<void> {
    // Check if this is a regular process
    const processInfo = this.processes.get(process);
    if (processInfo) {
      return this.stopRegularProcess(process, processInfo);
    }

    // Check if this is a PTY process wrapper
    const ptyProcess = (process as any)._ptyProcess;
    if (ptyProcess) {
      const ptyProcessInfo = this.ptyProcesses.get(ptyProcess);
      if (ptyProcessInfo) {
        return this.stopPtyProcess(ptyProcess, ptyProcessInfo, process);
      }
    }

    throw new Error('Process not managed by this AppProcessManager');
  }

  /**
   * Stops a regular spawn process
   */
  private async stopRegularProcess(process: ChildProcess, processInfo: ProcessInfo): Promise<void> {
    if (!this.isRunning(process)) {
      // Process already stopped
      this.cleanupProcess(process);
      return;
    }

    // Clear any hanging process detection timeout
    this.clearHangingProcessTimeout(process);

    try {
      // Try graceful shutdown first
      await this.attemptGracefulShutdown(process, processInfo.timeouts.gracefulShutdown);
    } catch (error) {
      console.warn('Graceful shutdown failed, proceeding to force termination:', error);
      
      // Force termination with SIGTERM
      await this.attemptForceTermination(process, processInfo.timeouts.forceKill);
    }

    // Final cleanup
    this.cleanupProcess(process);
  }

  /**
   * Stops a PTY process
   */
  private async stopPtyProcess(ptyProcess: pty.IPty, ptyProcessInfo: PtyProcessInfo, processWrapper: ChildProcess): Promise<void> {
    if (!this.isPtyRunning(ptyProcess)) {
      // Process already stopped
      this.cleanupPtyProcess(ptyProcess, processWrapper);
      return;
    }

    // Clear any hanging process detection timeout
    this.clearHangingProcessTimeout(ptyProcess);

    try {
      // Try graceful shutdown first
      await this.attemptPtyGracefulShutdown(ptyProcess, ptyProcessInfo.timeouts.gracefulShutdown);
    } catch (error) {
      console.warn('Graceful shutdown failed, proceeding to force termination:', error);
      
      // Force termination
      await this.attemptPtyForceTermination(ptyProcess, ptyProcessInfo.timeouts.forceKill);
    }

    // Final cleanup
    this.cleanupPtyProcess(ptyProcess, processWrapper);
  }

  /**
   * Sends input to the application's stdin
   * Requirements: 2.3 - Deliver text to application's stdin
   */
  async sendInput(process: ChildProcess, text: string): Promise<void> {
    if (!this.isRunning(process)) {
      throw new Error('Cannot send input to stopped process');
    }

    // Check if this is a PTY process wrapper
    const ptyProcess = (process as any)._ptyProcess;
    if (ptyProcess) {
      // Use PTY write method
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Input send timeout'));
        }, 5000);

        try {
          ptyProcess.write(text);
          clearTimeout(timeout);
          resolve();
        } catch (error) {
          clearTimeout(timeout);
          reject(new Error(`Failed to send input to PTY: ${error}`));
        }
      });
    }

    // Regular process stdin handling
    if (!process.stdin || process.stdin.destroyed) {
      throw new Error('Process stdin is not available');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Input send timeout'));
      }, 5000);

      process.stdin!.write(text, (error) => {
        clearTimeout(timeout);
        if (error) {
          reject(new Error(`Failed to send input: ${error}`));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Gets recent output from the application
   * Requirements: 2.3 - Handle stdout/stderr
   */
  async getOutput(process: ChildProcess, lines?: number): Promise<string> {
    // Check if this is a PTY process wrapper
    const ptyProcess = (process as any)._ptyProcess;
    if (ptyProcess) {
      const buffer = this.outputBuffers.get(ptyProcess) || '';
      
      if (lines === undefined) {
        return buffer;
      }

      const allLines = buffer.split('\n');
      const recentLines = allLines.slice(-lines);
      return recentLines.join('\n');
    }

    // Regular process handling
    const buffer = this.outputBuffers.get(process) || '';
    
    if (lines === undefined) {
      return buffer;
    }

    const allLines = buffer.split('\n');
    const recentLines = allLines.slice(-lines);
    return recentLines.join('\n');
  }

  /**
   * Checks if the process is still running
   * Requirements: 2.1 - Implement process monitoring and health checks
   */
  isRunning(process: ChildProcess): boolean {
    // Check if this is a PTY process wrapper
    const ptyProcess = (process as any)._ptyProcess;
    if (ptyProcess) {
      return this.isPtyRunning(ptyProcess);
    }

    // Regular process handling
    return process.exitCode === null && !process.killed;
  }

  /**
   * Waits for the process to exit with optional timeout
   * Requirements: 2.4 - Capture exit code and final state
   */
  async waitForExit(process: ChildProcess, timeout?: number): Promise<number> {
    const processInfo = this.processes.get(process);
    if (!processInfo) {
      throw new Error('Process not managed by this AppProcessManager');
    }

    // If process already exited, return the exit code
    if (process.exitCode !== null) {
      return process.exitCode;
    }

    const exitPromise = processInfo.exitPromise || Promise.resolve(0);

    if (timeout === undefined) {
      return await exitPromise;
    }

    // Apply timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Process exit timeout after ${timeout}ms`));
      }, timeout);
    });

    return await Promise.race([exitPromise, timeoutPromise]);
  }

  /**
   * Sets up output capture for stdout and stderr
   */
  private setupOutputCapture(process: ChildProcess): void {
    const appendOutput = (data: Buffer) => {
      const text = data.toString();
      const currentBuffer = this.outputBuffers.get(process) || '';
      this.outputBuffers.set(process, currentBuffer + text);
      
      // Keep buffer size reasonable (last 50KB)
      const buffer = this.outputBuffers.get(process)!;
      if (buffer.length > 50000) {
        this.outputBuffers.set(process, buffer.slice(-40000));
      }
    };

    if (process.stdout) {
      process.stdout.on('data', appendOutput);
    }

    if (process.stderr) {
      process.stderr.on('data', appendOutput);
    }
  }

  /**
   * Sets up exit event handling
   */
  private setupExitHandling(process: ChildProcess): Promise<number> {
    return new Promise((resolve, reject) => {
      process.on('exit', (code, signal) => {
        const processInfo = this.processes.get(process);
        if (processInfo) {
          processInfo.exitCode = code;
        }
        
        if (code !== null) {
          resolve(code);
        } else if (signal) {
          reject(new Error(`Process killed by signal: ${signal}`));
        } else {
          reject(new Error('Process exited with unknown status'));
        }
      });

      process.on('error', (error) => {
        reject(new Error(`Process error: ${error}`));
      });
    });
  }

  /**
   * Verifies that the application initialized successfully
   * Requirements: 2.2 - Verify successful initialization within 5 seconds
   */
  private async verifyInitialization(process: ChildProcess, timeoutMs: number): Promise<void> {
    const startTime = Date.now();
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Application initialization timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      const checkInitialization = () => {
        // Check if process is still running
        if (!this.isRunning(process)) {
          clearTimeout(timeout);
          reject(new Error('Process exited during initialization'));
          return;
        }

        const output = this.outputBuffers.get(process) || '';
        
        // Look for initialization indicators in the output
        // The blessed app should show some UI elements when it starts
        const hasUIElements = output.includes('Emotional Intelligence') || 
                             output.includes('[ei]') ||
                             output.includes('Chat:') ||
                             // Look for blessed box drawing characters which indicate UI rendering
                             /[┌┐└┘│─┬┴┼]/.test(output) ||
                             // Look for escape sequences that indicate terminal UI
                             /\x1b\[[0-9;]*[mK]/.test(output);

        if (hasUIElements) {
          clearTimeout(timeout);
          resolve();
          return;
        }

        // Check for obvious error conditions
        if (output.includes('Error:') || 
            output.includes('Cannot find module') ||
            output.includes('ENOENT') ||
            output.includes('EADDRINUSE')) {
          clearTimeout(timeout);
          reject(new Error(`Application initialization failed: ${output.slice(-500)}`));
          return;
        }

        // Continue checking if we haven't timed out
        if (Date.now() - startTime < timeoutMs) {
          setTimeout(checkInitialization, 100);
        }
      };

      // Start checking after a brief delay to allow initial output
      setTimeout(checkInitialization, 200);
    });
  }

  /**
   * Cleanup all managed processes
   * Useful for emergency cleanup scenarios
   */
  async cleanup(): Promise<void> {
    // Clear all hanging process timeouts
    for (const timeout of this.timeoutHandlers.values()) {
      clearTimeout(timeout);
    }
    this.timeoutHandlers.clear();

    // Cleanup regular processes
    const regularCleanupPromises = Array.from(this.processes.keys()).map(process => 
      this.stop(process).catch(error => {
        console.warn(`Warning: Failed to stop regular process:`, error);
      })
    );

    // Cleanup PTY processes
    const ptyCleanupPromises = Array.from(this.ptyProcesses.keys()).map(ptyProcess => {
      // Create a wrapper for the PTY process to use with stop()
      const wrapper = this.createPtyWrapper(ptyProcess);
      return this.stop(wrapper).catch(error => {
        console.warn(`Warning: Failed to stop PTY process:`, error);
      });
    });
    
    await Promise.all([...regularCleanupPromises, ...ptyCleanupPromises]);
  }

  /**
   * Sets up automatic termination for hanging processes
   * Requirements: 2.5 - Automatic process termination for hanging processes
   */
  private setupHangingProcessDetection(process: ChildProcess | pty.IPty): void {
    // Set up a timeout to detect hanging processes (30 minutes)
    const hangingTimeout = setTimeout(() => {
      console.warn('Process appears to be hanging, forcing termination');
      if ('kill' in process) {
        // Regular ChildProcess
        this.forceTerminateProcess(process as ChildProcess);
      } else {
        // PTY process
        try {
          (process as pty.IPty).kill();
        } catch (error) {
          console.error('Failed to kill hanging PTY process:', error);
        }
      }
    }, 30 * 60 * 1000); // 30 minutes

    // Store timeout for cleanup
    this.timeoutHandlers.set(process, hangingTimeout);
  }

  /**
   * Clears the hanging process timeout
   */
  private clearHangingProcessTimeout(process: ChildProcess | pty.IPty): void {
    const timeout = this.timeoutHandlers.get(process);
    if (timeout) {
      clearTimeout(timeout);
      this.timeoutHandlers.delete(process);
    }
  }

  /**
   * Attempts graceful shutdown with configurable timeout
   * Requirements: 2.2 - Configurable timeouts for different operations
   */
  private async attemptGracefulShutdown(process: ChildProcess, timeoutMs: number): Promise<void> {
    const processInfo = this.processes.get(process);
    if (!processInfo) {
      throw new Error('Process not managed by this AppProcessManager');
    }

    // Send quit command if stdin is available
    if (process.stdin && !process.stdin.destroyed) {
      try {
        await this.sendInput(process, '/quit\n');
      } catch (error) {
        throw new Error(`Failed to send quit command: ${error}`);
      }
    } else {
      throw new Error('Cannot send graceful shutdown command - stdin not available');
    }

    // Wait for graceful exit with timeout
    const exitPromise = processInfo.exitPromise || Promise.resolve(0);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Graceful shutdown timeout after ${timeoutMs}ms`)), timeoutMs);
    });

    await Promise.race([exitPromise, timeoutPromise]);
  }

  /**
   * Attempts force termination with configurable timeout
   * Requirements: 2.2 - Configurable timeouts for different operations
   */
  private async attemptForceTermination(process: ChildProcess, timeoutMs: number): Promise<void> {
    const processInfo = this.processes.get(process);
    if (!processInfo) {
      throw new Error('Process not managed by this AppProcessManager');
    }

    // Send SIGTERM
    process.kill('SIGTERM');
    
    // Wait for SIGTERM to work with timeout
    const exitPromise = processInfo.exitPromise || Promise.resolve(0);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`SIGTERM timeout after ${timeoutMs}ms`)), timeoutMs);
    });

    try {
      await Promise.race([exitPromise, timeoutPromise]);
    } catch (error) {
      // SIGTERM didn't work, use SIGKILL as last resort
      if (this.isRunning(process)) {
        console.warn('SIGTERM failed, using SIGKILL');
        process.kill('SIGKILL');
        
        // Wait a bit for SIGKILL (it should be immediate)
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  /**
   * Forces immediate termination of a process
   * Used for hanging process detection
   */
  private forceTerminateProcess(process: ChildProcess): void {
    if (this.isRunning(process)) {
      console.warn('Force terminating hanging process');
      process.kill('SIGKILL');
    }
    this.cleanupProcess(process);
  }

  /**
   * Cleans up process tracking data
   */
  private cleanupProcess(process: ChildProcess): void {
    this.processes.delete(process);
    this.outputBuffers.delete(process);
    this.clearHangingProcessTimeout(process);
  }

  /**
   * Cleans up PTY process tracking data
   */
  private cleanupPtyProcess(ptyProcess: pty.IPty, processWrapper: ChildProcess): void {
    this.ptyProcesses.delete(ptyProcess);
    this.outputBuffers.delete(ptyProcess);
    this.clearHangingProcessTimeout(ptyProcess);
  }

  /**
   * Attempts graceful shutdown for PTY process
   */
  private async attemptPtyGracefulShutdown(ptyProcess: pty.IPty, timeoutMs: number): Promise<void> {
    const ptyProcessInfo = this.ptyProcesses.get(ptyProcess);
    if (!ptyProcessInfo) {
      throw new Error('PTY process not managed by this AppProcessManager');
    }

    // Send quit command
    try {
      ptyProcess.write('/quit\n');
    } catch (error) {
      throw new Error(`Failed to send quit command to PTY: ${error}`);
    }

    // Wait for graceful exit with timeout
    const exitPromise = ptyProcessInfo.exitPromise || Promise.resolve(0);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`PTY graceful shutdown timeout after ${timeoutMs}ms`)), timeoutMs);
    });

    await Promise.race([exitPromise, timeoutPromise]);
  }

  /**
   * Attempts force termination for PTY process
   */
  private async attemptPtyForceTermination(ptyProcess: pty.IPty, timeoutMs: number): Promise<void> {
    const ptyProcessInfo = this.ptyProcesses.get(ptyProcess);
    if (!ptyProcessInfo) {
      throw new Error('PTY process not managed by this AppProcessManager');
    }

    // Send SIGTERM to PTY
    try {
      ptyProcess.kill('SIGTERM');
    } catch (error) {
      console.warn('Failed to send SIGTERM to PTY, trying SIGKILL:', error);
      try {
        ptyProcess.kill('SIGKILL');
      } catch (killError) {
        console.error('Failed to kill PTY process:', killError);
      }
    }
    
    // Wait for termination with timeout
    const exitPromise = ptyProcessInfo.exitPromise || Promise.resolve(0);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`PTY force termination timeout after ${timeoutMs}ms`)), timeoutMs);
    });

    try {
      await Promise.race([exitPromise, timeoutPromise]);
    } catch (error) {
      // Final attempt with SIGKILL
      if (this.isPtyRunning(ptyProcess)) {
        console.warn('SIGTERM failed for PTY, using SIGKILL');
        try {
          ptyProcess.kill('SIGKILL');
        } catch (killError) {
          console.error('SIGKILL failed for PTY:', killError);
        }
        
        // Wait a bit for SIGKILL (it should be immediate)
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  /**
   * Get information about all managed processes
   * Useful for testing and debugging
   */
  getManagedProcesses(): Array<{ process: ChildProcess; info: ProcessInfo }> {
    return Array.from(this.processes.entries()).map(([process, info]) => ({
      process,
      info: { ...info }
    }));
  }

  /**
   * Configure timeouts for a specific process
   * Requirements: 2.2 - Configurable timeouts for different operations
   */
  configureTimeouts(process: ChildProcess, timeouts: Partial<ProcessTimeouts>): void {
    const processInfo = this.processes.get(process);
    if (!processInfo) {
      throw new Error('Process not managed by this AppProcessManager');
    }

    processInfo.timeouts = { ...processInfo.timeouts, ...timeouts };
  }

  /**
   * Get current timeout configuration for a process
   */
  getTimeouts(process: ChildProcess): ProcessTimeouts {
    const processInfo = this.processes.get(process);
    if (!processInfo) {
      throw new Error('Process not managed by this AppProcessManager');
    }

    return { ...processInfo.timeouts };
  }

  /**
   * Get final state information for a process
   * Requirements: 2.5 - Handle process exit codes and final state capture
   */
  getFinalState(process: ChildProcess): ProcessFinalState {
    const processInfo = this.processes.get(process);
    if (processInfo) {
      const output = this.outputBuffers.get(process) || '';
      const runtime = processInfo.exitCode !== null ? 
        Date.now() - processInfo.startTime : 
        Date.now() - processInfo.startTime;

      return {
        exitCode: processInfo.exitCode,
        runtime,
        finalOutput: output.slice(-1000), // Last 1KB of output
        wasKilled: process.killed,
        startTime: processInfo.startTime,
        config: { ...processInfo.config }
      };
    }

    // Check if it's a PTY process
    for (const [ptyProcess, ptyInfo] of this.ptyProcesses.entries()) {
      if ((process as any)._ptyProcess === ptyProcess) {
        const output = this.outputBuffers.get(ptyProcess) || '';
        const runtime = ptyInfo.exitCode !== null ? 
          Date.now() - ptyInfo.startTime : 
          Date.now() - ptyInfo.startTime;

        return {
          exitCode: ptyInfo.exitCode,
          runtime,
          finalOutput: output.slice(-1000),
          wasKilled: false, // PTY processes don't have a killed property
          startTime: ptyInfo.startTime,
          config: { ...ptyInfo.config }
        };
      }
    }

    throw new Error('Process not managed by this AppProcessManager');
  }

  // PTY-specific helper methods

  /**
   * Creates a ChildProcess-like wrapper around a PTY process for compatibility
   */
  private createPtyWrapper(ptyProcess: pty.IPty): ChildProcess {
    const wrapper = {
      exitCode: null,
      killed: false,
      pid: ptyProcess.pid,
      stdin: {
        write: (data: string, callback?: (error?: Error | null) => void) => {
          try {
            ptyProcess.write(data);
            if (callback) callback();
            return true;
          } catch (error) {
            if (callback) callback(error as Error);
            return false;
          }
        },
        destroyed: false
      },
      stdout: null,
      stderr: null,
      kill: (signal?: string | number) => {
        try {
          ptyProcess.kill(signal as string);
          return true;
        } catch {
          return false;
        }
      },
      _ptyProcess: ptyProcess // Store reference for identification
    } as any;

    return wrapper as ChildProcess;
  }

  /**
   * Sets up output capture for PTY process
   */
  private setupPtyOutputCapture(ptyProcess: pty.IPty): void {
    ptyProcess.onData((data: string) => {
      const currentBuffer = this.outputBuffers.get(ptyProcess) || '';
      this.outputBuffers.set(ptyProcess, currentBuffer + data);
      
      // Keep buffer size reasonable (last 50KB)
      const buffer = this.outputBuffers.get(ptyProcess)!;
      if (buffer.length > 50000) {
        this.outputBuffers.set(ptyProcess, buffer.slice(-40000));
      }
    });
  }

  /**
   * Sets up exit event handling for PTY process
   */
  private setupPtyExitHandling(ptyProcess: pty.IPty, processWrapper: ChildProcess): Promise<number> {
    return new Promise((resolve, reject) => {
      ptyProcess.onExit(({ exitCode, signal }) => {
        const processInfo = this.ptyProcesses.get(ptyProcess);
        if (processInfo) {
          processInfo.exitCode = exitCode;
        }
        
        // Update wrapper
        (processWrapper as any).exitCode = exitCode;
        
        if (exitCode !== undefined && exitCode !== null) {
          resolve(exitCode);
        } else if (signal) {
          reject(new Error(`Process killed by signal: ${signal}`));
        } else {
          reject(new Error('Process exited with unknown status'));
        }
      });
    });
  }

  /**
   * Verifies that the PTY application initialized successfully
   */
  private async verifyPtyInitialization(ptyProcess: pty.IPty, timeoutMs: number): Promise<void> {
    const startTime = Date.now();
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Application initialization timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      const checkInitialization = () => {
        // Check if process is still running
        if (!this.isPtyRunning(ptyProcess)) {
          clearTimeout(timeout);
          reject(new Error('Process exited during initialization'));
          return;
        }

        const output = this.outputBuffers.get(ptyProcess) || '';
        
        // Look for initialization indicators in the output
        // The blessed app should show some UI elements when it starts
        const hasUIElements = output.includes('Emotional Intelligence') || 
                             output.includes('[ei]') ||
                             output.includes('Chat:') ||
                             // Look for blessed box drawing characters which indicate UI rendering
                             /[┌┐└┘│─┬┴┼]/.test(output) ||
                             // Look for escape sequences that indicate terminal UI
                             /\x1b\[[0-9;]*[mK]/.test(output);

        if (hasUIElements) {
          clearTimeout(timeout);
          resolve();
          return;
        }

        // Check for obvious error conditions
        if (output.includes('Error:') || 
            output.includes('Cannot find module') ||
            output.includes('ENOENT') ||
            output.includes('EADDRINUSE')) {
          clearTimeout(timeout);
          reject(new Error(`Application initialization failed: ${output.slice(-500)}`));
          return;
        }

        // Continue checking if we haven't timed out
        if (Date.now() - startTime < timeoutMs) {
          setTimeout(checkInitialization, 100);
        }
      };

      // Start checking after a brief delay to allow initial output
      setTimeout(checkInitialization, 200);
    });
  }

  /**
   * Checks if PTY process is still running
   */
  private isPtyRunning(ptyProcess: pty.IPty): boolean {
    try {
      // PTY processes don't have a direct "running" check, but we can check if pid exists
      return ptyProcess.pid !== undefined && ptyProcess.pid > 0;
    } catch {
      return false;
    }
  }
}

interface ProcessInfo {
  startTime: number;
  config: AppConfig;
  exitCode: number | null;
  exitPromise: Promise<number> | null;
  timeouts: ProcessTimeouts;
}

interface PtyProcessInfo {
  startTime: number;
  config: AppConfig;
  exitCode: number | null;
  exitPromise: Promise<number> | null;
  timeouts: ProcessTimeouts;
  ptyProcess: pty.IPty;
}

interface ProcessTimeouts {
  initialization: number;
  gracefulShutdown: number;
  forceKill: number;
}

interface ProcessFinalState {
  exitCode: number | null;
  runtime: number;
  finalOutput: string;
  wasKilled: boolean;
  startTime: number;
  config: AppConfig;
}