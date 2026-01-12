import { ICommandHandler, ParsedCommand, CommandHandlerDependencies } from './interfaces.js';
import { findPersonaByNameOrAlias } from '../storage.js';
import { appendDebugLog } from '../storage.js';

function debugLog(message: string) {
  appendDebugLog(message);
}

/**
 * CommandHandler - Handles parsing and execution of user commands
 * 
 * Extracted from app.ts to centralize all command handling logic.
 * Supports commands: /persona, /quit, /refresh, /help
 */
export class CommandHandler implements ICommandHandler {
  private personaManager: CommandHandlerDependencies['personaManager'];
  private messageProcessor: CommandHandlerDependencies['messageProcessor'];
  private app: CommandHandlerDependencies['app'];

  constructor(dependencies: CommandHandlerDependencies) {
    this.personaManager = dependencies.personaManager;
    this.messageProcessor = dependencies.messageProcessor;
    this.app = dependencies.app;
  }

  /**
   * Parse user input to extract command and arguments
   * @param input - Raw user input string
   * @returns Parsed command object or null if not a command
   */
  parseCommand(input: string): ParsedCommand | null {
    if (!input.startsWith('/')) {
      return null;
    }

    const spaceIdx = input.indexOf(' ');
    const command = spaceIdx === -1 ? input.slice(1) : input.slice(1, spaceIdx);
    const args = spaceIdx === -1 ? [] : [input.slice(spaceIdx + 1)];

    // Normalize command to supported types
    const normalizedCommand = this.normalizeCommand(command);
    if (!normalizedCommand) {
      return null;
    }

    return {
      type: normalizedCommand,
      args,
      raw: input
    };
  }

  /**
   * Execute a parsed command
   * @param command - Parsed command to execute
   * @returns Promise that resolves when command execution is complete
   */
  async executeCommand(command: ParsedCommand): Promise<void> {
    debugLog(`Executing command: ${command.type} with args: [${command.args.join(', ')}]`);

    switch (command.type) {
      case 'persona':
        await this.handlePersonaCommand(command.args[0] || '');
        break;
      case 'quit':
        await this.handleQuitCommand(command.args[0] || '');
        break;
      case 'refresh':
        this.handleRefreshCommand();
        break;
      case 'help':
        this.handleHelpCommand();
        break;
      default:
        this.app.setStatus(`Unknown command: /${command.type}`);
    }
  }

  /**
   * Get help text for all available commands
   * @returns Formatted help text string
   */
  getHelpText(): string {
    return 'Commands: /persona <name>, /quit|/q [--force] (exit app, --force bypasses safety checks), /refresh, /help | Keys: Ctrl+H (personas), Ctrl+L (input), Ctrl+R (refresh), Ctrl+C (exit)';
  }

  /**
   * Normalize command aliases to standard command types
   * @param command - Raw command string
   * @returns Normalized command type or null if invalid
   */
  private normalizeCommand(command: string): ParsedCommand['type'] | null {
    const cmd = command.toLowerCase();
    
    switch (cmd) {
      case 'persona':
      case 'p':
        return 'persona';
      case 'quit':
      case 'q':
        return 'quit';
      case 'refresh':
      case 'r':
        return 'refresh';
      case 'help':
      case 'h':
        return 'help';
      default:
        return null;
    }
  }

  /**
   * Handle persona switching command
   * @param args - Command arguments (persona name)
   */
  private async handlePersonaCommand(args: string): Promise<void> {
    const trimmed = args.trim();
    
    if (!trimmed) {
      // List available personas
      const personas = this.personaManager.getPersonas();
      const currentPersona = this.personaManager.getCurrentPersona();
      const unreadCounts = this.personaManager.getUnreadCounts();
      
      const list = personas.map(p => {
        const marker = p.name === currentPersona ? '[active]' : '';
        const unread = unreadCounts.get(p.name) || 0;
        const unreadStr = unread ? ` (${unread} unread)` : '';
        return `${p.name}${marker}${unreadStr}`;
      }).join(', ');
      
      this.app.setStatus(`Available personas: ${list}`);
      return;
    }

    // Switch to specified persona
    const foundPersona = await findPersonaByNameOrAlias(trimmed.toLowerCase());
    if (foundPersona) {
      await this.personaManager.switchPersona(foundPersona);
    } else {
      this.app.setStatus(`Persona "${trimmed}" not found.`);
    }
  }

  /**
   * Handle quit command with optional --force flag
   * @param args - Command arguments (optional --force flag)
   */
  private async handleQuitCommand(args: string): Promise<void> {
    const trimmedArgs = args.trim();
    
    // Enhanced argument validation
    if (trimmedArgs) {
      // Split arguments and filter out empty strings
      const argList = trimmedArgs.split(/\s+/).filter(arg => arg.length > 0);
      
      // Check for multiple arguments
      if (argList.length > 1) {
        debugLog(`Quit command validation failed: multiple arguments provided: [${argList.join(', ')}]`);
        this.app.setStatus(`Too many arguments. Usage: /quit [--force]`);
        return;
      }
      
      // Check for single valid argument
      const singleArg = argList[0];
      if (singleArg !== "--force") {
        debugLog(`Quit command validation failed: invalid argument: "${singleArg}"`);
        
        // Provide helpful suggestions for common mistakes
        if (singleArg === "-f" || singleArg === "force") {
          this.app.setStatus(`Invalid argument: ${singleArg}. Did you mean --force? Usage: /quit [--force]`);
        } else if (singleArg.startsWith("-")) {
          this.app.setStatus(`Unknown flag: ${singleArg}. Only --force is supported. Usage: /quit [--force]`);
        } else {
          this.app.setStatus(`Invalid argument: ${singleArg}. Usage: /quit [--force]`);
        }
        return;
      }
    }
    
    const isForce = trimmedArgs === "--force";
    
    try {
      if (isForce) {
        // Force exit: bypass all safety checks
        debugLog('Force quit command executed - bypassing all safety checks');
        this.executeForceQuit();
        return;
      }
      
      // Regular quit: delegate to app's exit logic
      debugLog('Regular quit command executed - using shared exit logic');
      this.executeRegularQuit();
    } catch (error) {
      debugLog(`Quit command execution error: ${error instanceof Error ? error.message : String(error)}`);
      this.app.setStatus(`Error executing quit command: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Handle refresh command
   */
  private handleRefreshCommand(): void {
    debugLog('Manual refresh command triggered');
    
    // Delegate to app's refresh logic
    this.executeRefresh();
    
    // Note: The actual refresh implementation will be handled by the app
    // since it involves screen manipulation that the command handler shouldn't know about
  }

  /**
   * Handle help command
   */
  private handleHelpCommand(): void {
    this.app.setStatus(this.getHelpText());
  }

  /**
   * Execute force quit (bypass all safety checks)
   * This method delegates to the app's force quit logic
   */
  private executeForceQuit(): void {
    // Force exit: bypass all safety checks
    // This mirrors the logic from the original handleQuitCommand
    try {
      const cleanupResult = (this.app as any).cleanup();
      
      if (!cleanupResult.success) {
        debugLog(`Force quit cleanup had errors: ${cleanupResult.errors.join('; ')}`);
        // Continue with force exit regardless of cleanup errors
      }
      
      (this.app as any).screen.destroy();
      process.exit(0);
    } catch (error) {
      debugLog(`Critical error during force quit: ${error instanceof Error ? error.message : String(error)}`);
      // Force exit even if everything fails
      try {
        (this.app as any).screen.destroy();
      } catch (screenError) {
        debugLog(`Screen destroy failed during force quit: ${screenError instanceof Error ? screenError.message : String(screenError)}`);
      }
      process.exit(1);
    }
  }

  /**
   * Execute regular quit (use shared exit logic)
   * This method delegates to the app's shared exit logic
   */
  private executeRegularQuit(): void {
    // Regular quit: use shared exit logic (identical to Ctrl+C)
    (this.app as any).executeExitLogic();
  }

  /**
   * Execute refresh command
   * This method delegates to the app's refresh logic
   */
  private executeRefresh(): void {
    // Delegate to the app's handleRefreshCommand method
    (this.app as any).handleRefreshCommand();
  }
}