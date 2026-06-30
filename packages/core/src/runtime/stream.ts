import { useState, useCallback, useRef } from 'react';

export interface UseStreamResult {
  /** Accumulated text so far. */
  text: string;
  /** Whether a stream is currently active. */
  isStreaming: boolean;
  /** Start streaming from an async generator. Cancels any previous stream. */
  stream(source: AsyncIterable<string>): void;
}

/**
 * React hook for streaming text into a message with throttled updates.
 *
 * @param opts.throttleMs - Minimum ms between re-renders (default 500). Prevents Telegram rate-limit errors.
 *
 * @example
 * function StreamDemo() {
 *   const { text, isStreaming, stream } = useStream();
 *
 *   async function* generate() {
 *     yield "Loading";
 *     await delay(500);
 *     yield " your data...";
 *   }
 *
 *   return (
 *     <Message text={text || "Click to start"}>
 *       <Button text={isStreaming ? "⏳ Streaming…" : "▶️ Start"} onClick={() => stream(generate())} />
 *     </Message>
 *   );
 * }
 */
export function useStream(opts?: { throttleMs?: number }): UseStreamResult {
  const [text, setText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const throttle = opts?.throttleMs ?? 500;
  const generationRef = useRef(0);

  const startStream = useCallback((source: AsyncIterable<string>) => {
    const id = ++generationRef.current;
    setIsStreaming(true);
    setText('');

    (async () => {
      let accumulated = '';
      let lastFlush = 0;

      for await (const chunk of source) {
        if (generationRef.current !== id) break;
        accumulated += chunk;
        const now = Date.now();
        if (now - lastFlush >= throttle) {
          setText(accumulated);
          lastFlush = now;
        }
      }

      if (generationRef.current === id) {
        setText(accumulated);
        setIsStreaming(false);
      }
    })();
  }, [throttle]);

  return { text, isStreaming, stream: startStream };
}
