import { writeFile, mkdir } from "fs/promises";

const TRACE_DIR = "/var/log/pideploy/traces";

export interface TranscriptEntry {
  timestamp: number;
  type: string;
  data: any;
}

export interface TranscriptCapture {
  processEvent(event: any): void;
  getTranscript(): TranscriptEntry[];
  save(traceId: string): Promise<string>;
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? `${s.slice(0, maxLen)}...` : s;
}

export function createTranscriptCapture(): TranscriptCapture {
  const transcript: TranscriptEntry[] = [];

  function processEvent(event: any): void {
    const entry: TranscriptEntry = {
      timestamp: Date.now(),
      type: event.type,
      data: {},
    };

    switch (event.type) {
      case "message_end":
        entry.data = {
          role: event.message?.role,
          contentTypes: event.message?.content?.map((c: any) => c.type),
          model: event.message?.model,
          usage: event.message?.usage,
          stopReason: event.message?.stopReason,
        };
        break;
      case "tool_execution_start":
        entry.data = { tool: event.toolName, args: event.args };
        break;
      case "tool_execution_end":
        entry.data = {
          tool: event.toolName,
          isError: event.isError,
          resultPreview: truncate(JSON.stringify(event.result ?? ""), 500),
        };
        break;
      case "auto_retry_start":
        entry.data = { attempt: event.attempt, error: event.errorMessage };
        break;
      default:
        entry.data = { raw: event.type };
    }

    transcript.push(entry);
  }

  return {
    processEvent,
    getTranscript: () => [...transcript],
    save: async (traceId: string) => {
      await mkdir(TRACE_DIR, { recursive: true });
      const filepath = `${TRACE_DIR}/transcript_${traceId}.json`;
      await writeFile(filepath, JSON.stringify(transcript, null, 2));
      return filepath;
    },
  };
}
