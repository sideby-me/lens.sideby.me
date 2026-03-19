import type { Response } from 'express';

export function writeEvent(res: Response, type: string, data: Record<string, unknown>): void {
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function closeSSE(res: Response): void {
  res.end();
}
