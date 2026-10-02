import { useState, useCallback, useRef, useEffect } from 'react';

export interface UseStreamResult {
  /** Accumulated text so far. */
  text: string;
  /** Whether a stream is currently active. */
  isStreaming: boolean;
  /** The error thrown by the source, if the last stream failed. */
  error: Error | null;
  /** Start streaming from an async iterable. Cancels any previous stream. */
  stream(source: AsyncIterable<string>): void;
  /** Stop the current stream, keeping the text received so far. */
  stop(): void;
}

/**
 * React hook for streaming text (e.g. LLM tokens) into a message with throttled updates.
 *
 * @param opts.throttleMs - Minimum ms between re-renders (default 1000). Each re-render is a
 *   message edit; Telegram rate-limits edits to roughly one per second per chat.
 *
 * @example
 * function StreamDemo() {
 *   const { text, isStreaming, error, stream } = useStream();
 *
 *   async function* generate() {
 *     yield "Loading";
 *     await delay(500);
 *     yield " your data...";
 *   }
 *
 *   return (
 *     <Message text={error ? `⚠️ ${error.message}` : text || "Click to start"}>
 *       <InlineKeyboard>
 *         <Button text={isStreaming ? "⏳ Streaming…" : "▶️ Start"} onClick={() => stream(generate())} />
 *       </InlineKeyboard>
 *     </Message>
 *   );
 * }
 */
export function useStream(opts?: { throttleMs?: number }): UseStreamResult {
  const [text, setText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const throttle = opts?.throttleMs ?? 1000;
  const generationRef = useRef(0);
  const iteratorRef = useRef<AsyncIterator<string> | null>(null);

  const stop = useCallback(() => {
    generationRef.current++;
    const it = iteratorRef.current;
    iteratorRef.current = null;
    // Tell the producer to clean up (closes fetch streams / LLM requests).
    it?.return?.().catch(() => {});
    setIsStreaming(false);
  }, []);

  // Abort the producer if the component unmounts mid-stream.
  useEffect(() => () => {
    generationRef.current++;
    iteratorRef.current?.return?.().catch(() => {});
  }, []);

  const startStream = useCallback((source: AsyncIterable<string>) => {
    stop();
    const id = ++generationRef.current;
    const iterator = source[Symbol.asyncIterator]();
    iteratorRef.current = iterator;
    setIsStreaming(true);
    setError(null);
    setText('');

    (async () => {
      let accumulated = '';
      let lastFlush = 0;
      try {
        for (;;) {
          const { value, done } = await iterator.next();
          if (done || generationRef.current !== id) break;
          accumulated += value;
          const now = Date.now();
          if (now - lastFlush >= throttle) {
            setText(accumulated);
            lastFlush = now;
          }
        }
      } catch (err) {
        if (generationRef.current === id) setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (generationRef.current === id) {
          iteratorRef.current = null;
          setText(accumulated);
          setIsStreaming(false);
        }
      }
    })();
  }, [throttle, stop]);

  return { text, isStreaming, error, stream: startStream, stop };
}
