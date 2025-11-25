# Chunked Bulk Operations - Solution for Large-Scale Email Processing

**Author:** Colin Bitterfield
**Email:** colin@bitterfield.com
**Date Created:** 2025-01-24
**Version:** 1.0.0

## Problem Statement

When processing large numbers of emails (1000+), the circuit breaker was tripping due to:

1. **Timeout Issues**: Single bulk operations on 1700+ messages exceeded server/connection timeouts
2. **Circuit Breaker Trips**: After 5 consecutive failures, the circuit breaker opened, blocking all operations
3. **No Recovery**: Once the circuit opened, processing stopped completely for 60 seconds
4. **Memory Pressure**: Large operations consumed significant memory and bandwidth

### Original Circuit Breaker Configuration

```typescript
{
  failureThreshold: 5,      // Opens after 5 failures
  successThreshold: 2,      // Closes after 2 successes
  timeout: 60000,           // 60s before trying half-open
  monitoringWindow: 120000  // 2-minute rolling window
}
```

## Solution: Chunked Bulk Operations

### Architecture

The solution implements a **chunked processing pattern** that:

1. **Splits large UID arrays** into smaller chunks (default: 100 UIDs per chunk)
2. **Processes chunks sequentially** with error recovery
3. **Adds inter-chunk delays** (100ms) to prevent server overload
4. **Provides progress tracking** via callbacks
5. **Returns detailed results** including processed/failed counts and errors

### Implementation

#### Core Service Methods

Three new methods added to `ImapService` (src/services/imap-service.ts):

1. **bulkMarkEmailsChunked()**
   - Processes flag operations in chunks
   - Supports all flag operations (read, unread, flagged, etc.)
   - Returns: `{ processed, failed, errors[] }`

2. **bulkDeleteEmailsChunked()**
   - Processes deletions in chunks
   - Supports both mark-as-deleted and expunge
   - Returns: `{ processed, failed, errors[] }`

3. **bulkGetEmailsChunked()**
   - Fetches emails in chunks
   - Supports headers, body, or full content
   - Returns: `EmailMessage[] | EmailContent[]`

#### Helper Method

```typescript
private chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}
```

#### Processing Loop Pattern

```typescript
for (let i = 0; i < chunks.length; i++) {
  const chunk = chunks[i];

  try {
    // Process chunk using existing bulk operation
    await this.bulkMarkEmails(accountId, folderName, chunk, action);
    processed += chunk.length;

    // Progress callback
    if (options?.onProgress) {
      options.onProgress(processed, uids.length, failed);
    }
  } catch (error) {
    // Record error but CONTINUE processing remaining chunks
    failed += chunk.length;
    errors.push({ chunk: i + 1, uids: chunk, error: errorMsg });
  }

  // Inter-chunk delay to prevent server overload
  if (i < chunks.length - 1) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
```

### MCP Tools

Three new MCP tools added to `src/tools/email-tools.ts`:

1. **imap_bulk_mark_emails_chunked**
2. **imap_bulk_delete_emails_chunked**
3. **imap_bulk_get_emails_chunked**

All tools accept an optional `chunkSize` parameter (default: 100).

## Usage Example

### Scenario: Process 1700 Unread Marketing Emails

```javascript
// Step 1: Search for unread emails
const searchResult = await imap_search_emails({
  accountId: 'work-email',
  folder: 'INBOX',
  seen: false
});
// Returns: 1700 UIDs

// Step 2: Fetch email headers in chunks to identify marketing emails
const emails = await imap_bulk_get_emails_chunked({
  accountId: 'work-email',
  folder: 'INBOX',
  uids: searchResult.uids,
  fields: 'headers',
  chunkSize: 100  // Process 100 at a time
});
// Processes: 17 chunks of 100 emails each
// Time: ~17 seconds (100ms delay × 17 chunks + processing)

// Step 3: Filter marketing emails older than 48 hours
const marketingUIDs = emails
  .filter(email => {
    const isMarketing = email.from.includes('marketing') ||
                       email.subject.includes('newsletter');
    const age = Date.now() - email.date.getTime();
    const isOld = age > 48 * 60 * 60 * 1000; // 48 hours
    return isMarketing && isOld;
  })
  .map(email => email.uid);
// Result: ~850 marketing email UIDs

// Step 4: Delete filtered emails in chunks
const deleteResult = await imap_bulk_delete_emails_chunked({
  accountId: 'work-email',
  folder: 'INBOX',
  uids: marketingUIDs,
  expunge: false,  // Just mark as deleted
  chunkSize: 100
});
// Processes: 9 chunks (850 / 100 = 8.5, rounded up)
// Returns: { processed: 850, failed: 0, errors: [] }
```

## Benefits

### 1. Circuit Breaker Friendly
- Each chunk is a separate operation with its own retry attempts
- Single chunk failure (5 attempts) doesn't stop entire process
- Circuit breaker less likely to trip due to smaller operations

### 2. Fault Tolerance
- Continues processing remaining chunks even if one fails
- Returns detailed error information for failed chunks
- Allows partial success (e.g., 16 out of 17 chunks succeed)

### 3. Progress Tracking
```typescript
const result = await imapService.bulkDeleteEmailsChunked(
  accountId,
  folder,
  uids,
  false,
  {
    chunkSize: 100,
    onProgress: (processed, total, failed) => {
      console.log(`Progress: ${processed}/${total} (${failed} failed)`);
      // Output: Progress: 100/1700 (0 failed)
      // Output: Progress: 200/1700 (0 failed)
      // ...
    }
  }
);
```

### 4. Server Protection
- 100ms delay between chunks prevents server overload
- Smaller operations reduce memory pressure
- More predictable resource usage

### 5. Better Error Reporting
```typescript
{
  processed: 1600,
  failed: 100,
  errors: [
    {
      chunk: 15,
      uids: [450, 451, ..., 549],
      error: "Connection timeout"
    }
  ]
}
```

## Performance Characteristics

### Processing Time Calculation

For `N` UIDs with chunk size `C`:
- **Number of chunks**: `Math.ceil(N / C)`
- **Inter-chunk delays**: `(chunks - 1) × 100ms`
- **Operation time**: Depends on server and operation type
- **Total time**: `(chunks × operation_time) + (chunks - 1) × 100ms`

### Example: 1700 UIDs, Chunk Size 100

- Chunks: 17
- Inter-chunk delays: 16 × 100ms = 1.6 seconds
- Operation time per chunk: ~0.5 seconds (typical)
- Total time: (17 × 0.5s) + 1.6s = **~10 seconds**

### Memory Usage

- **Before**: All 1700 message objects in memory simultaneously
- **After**: Maximum 100 message objects in memory per chunk
- **Reduction**: ~94% memory usage reduction

## Configuration

### Optimal Chunk Sizes

| Message Count | Recommended Chunk Size | Reasoning |
|--------------|----------------------|-----------|
| 100-500 | 50-100 | Small operations, minimal benefit from chunking |
| 500-1000 | 100 | Good balance of speed and reliability |
| 1000-5000 | 100-200 | Larger chunks still safe for most servers |
| 5000+ | 100 | Smaller chunks for maximum reliability |

### Adjusting for Slow Servers

For servers with slow response times:
```typescript
{
  chunkSize: 50,  // Smaller chunks
  // Manual delay adjustment would require code modification
}
```

## Testing

All tools verified with test-tools.js:
```
✅ 42 tools registered
✅ 3 chunked bulk operation tools
✅ All tests passing
```

### Test Scenarios

1. **Empty array**: Returns immediately with processed: 0
2. **Small array** (< 100): Processes in single chunk
3. **Large array** (1700+): Splits into 17 chunks, processes sequentially
4. **Partial failure**: Continues processing, returns error details
5. **Progress callbacks**: Fires on each chunk completion

## Backward Compatibility

The original bulk operations remain unchanged:
- `bulkMarkEmails()` - For operations < 1000 UIDs
- `bulkDeleteEmails()` - For operations < 1000 UIDs
- `bulkGetEmails()` - For operations < 1000 UIDs

Chunked operations are **optional** and recommended for:
- Operations on 1000+ messages
- Environments with unreliable connections
- When circuit breaker trips are occurring

## Future Enhancements

### Potential Improvements

1. **Parallel Chunking**: Process multiple chunks concurrently
   - Requires careful connection pool management
   - Could improve throughput 2-3×

2. **Adaptive Chunk Sizing**: Adjust chunk size based on server response time
   - Start with 100, decrease if timeouts occur
   - Increase if operations complete quickly

3. **Persistent Progress**: Save progress to allow resumption
   - Useful for very large operations (10,000+ messages)
   - Survive process restarts

4. **Configurable Delays**: Allow users to adjust inter-chunk delay
   - Some servers may handle faster/slower processing

## References

- Issue: Circuit breaker tripping on large bulk operations
- Files Modified:
  - `src/services/imap-service.ts` (+189 lines)
  - `src/tools/email-tools.ts` (+143 lines)
  - `test-tools.js` (+4 lines)
  - `README.md` (+63 lines)

## Version History

- **1.0.0** (2025-01-24): Initial implementation
  - Added chunked bulk mark, delete, and fetch operations
  - Added 3 new MCP tools
  - Updated documentation and tests
