export interface OperationMetadata {
  timestamp: string;
  executionTimeMs: number;
  operation: string;
  resultCount?: number;
  truncated?: boolean;
  notes?: string[];
  disclaimer: string;
}

const LATENCY_DISCLAIMER =
  'executionTimeMs measures Redis command latency through this MCP connection only. It does not reflect application cache latency, framework overhead, or end-to-end API response time.';

export class MetadataCollector {
  private startTime: number;
  private operationName: string;
  private enabled: boolean;
  private level: 'minimal' | 'standard' | 'detailed';

  constructor(operationName: string, enabled = true, level: 'minimal' | 'standard' | 'detailed' = 'standard') {
    this.operationName = operationName;
    this.enabled = enabled;
    this.level = level;
    this.startTime = Date.now();
  }

  public complete(extra?: { resultCount?: number; truncated?: boolean; notes?: string[] }): OperationMetadata | undefined {
    if (!this.enabled) {
      return undefined;
    }

    const executionTimeMs = Date.now() - this.startTime;

    const metadata: OperationMetadata = {
      timestamp: new Date().toISOString(),
      executionTimeMs,
      operation: this.operationName,
      disclaimer: LATENCY_DISCLAIMER
    };

    if (extra?.resultCount !== undefined) {
      metadata.resultCount = extra.resultCount;
    }

    if (extra?.truncated !== undefined) {
      metadata.truncated = extra.truncated;
    }

    if (this.level === 'detailed' && extra?.notes && extra.notes.length > 0) {
      metadata.notes = extra.notes;
    }

    return metadata;
  }
}
