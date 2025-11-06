/**
 * Error Handling Utilities for MCP Tools
 *
 * Provides centralized error handling for all MCP tool operations.
 * Prevents server crashes by catching and formatting errors appropriately.
 *
 * Author: Colin Bitterfield
 * Email: colin.bitterfield@templeofepiphany.com
 * Version: 2.5.1
 * Date: 2025-11-05
 */

export interface ErrorResponse {
  success: false;
  error: string;
  errorType: string;
  errorCode?: string;
  details?: any;
}

export interface SuccessResponse {
  success: true;
  [key: string]: any;
}

export type ToolResponse = ErrorResponse | SuccessResponse;

/**
 * Standardized error response format for MCP tools
 */
export function formatErrorResponse(error: unknown): ErrorResponse {
  if (error instanceof Error) {
    return {
      success: false,
      error: error.message,
      errorType: error.name,
      errorCode: (error as any).code,
      details: {
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }
    };
  }

  return {
    success: false,
    error: String(error),
    errorType: 'UnknownError'
  };
}

/**
 * Wraps an async tool handler with error handling
 * Prevents uncaught exceptions from crashing the MCP server
 */
export function withErrorHandling<TArgs = any>(
  handler: (args: TArgs) => Promise<any>
): (args: TArgs) => Promise<any> {
  return async (args: TArgs) => {
    try {
      return await handler(args);
    } catch (error) {
      console.error('[MCP Tool Error]', error);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(formatErrorResponse(error), null, 2)
        }]
      };
    }
  };
}

/**
 * Validates required parameters and throws descriptive errors
 */
export function validateRequired<T>(value: T | undefined | null, paramName: string): T {
  if (value === undefined || value === null) {
    throw new Error(`Missing required parameter: ${paramName}`);
  }
  return value;
}

/**
 * Validates that at least one of the specified parameters is provided
 */
export function validateOneOf(params: Record<string, any>, paramNames: string[]): void {
  const hasOne = paramNames.some(name => params[name] !== undefined && params[name] !== null);
  if (!hasOne) {
    throw new Error(`At least one of these parameters is required: ${paramNames.join(', ')}`);
  }
}

/**
 * Custom error classes for better error categorization
 */
export class AccountNotFoundError extends Error {
  constructor(accountId: string) {
    super(`Account not found: ${accountId}`);
    this.name = 'AccountNotFoundError';
  }
}

export class ConnectionError extends Error {
  constructor(message: string, public cause?: Error) {
    super(message);
    this.name = 'ConnectionError';
  }
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class OperationError extends Error {
  constructor(operation: string, cause?: Error) {
    super(`Operation failed: ${operation}${cause ? ` - ${cause.message}` : ''}`);
    this.name = 'OperationError';
  }
}
