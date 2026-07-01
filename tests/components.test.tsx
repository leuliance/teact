import { describe, test, expect } from 'bun:test';
import React from 'react';
import { createRoot, type OutputNode } from '../packages/core/src/renderer';
import {
  Message, Button, ButtonRow, InlineKeyboard,
  Photo, Document, Bold, Italic, Code,
  Alert, List, ListItem, Divider, SuspenseFallback,
} from '../packages/ui/src';

function waitForCommit(): Promise<void> {
  return new Promise((r) => setTimeout(r, 10));
}

function renderSync(el: React.ReactElement): OutputNode | null {
  let out: OutputNode | null = null;
  const root = createRoot((tree) => { out = tree; });
  root.render(el);
  return out;
}

describe('Component validation', () => {
  test('Button outside InlineKeyboard throws', async () => {
    const errors: Error[] = [];
    const origError = console.error;
    console.error = (...args: any[]) => {
      if (args[0] instanceof Error) errors.push(args[0]);
      else if (typeof args[0] === 'string' && args.length > 1 && args[1] instanceof Error) errors.push(args[1]);
    };

    const root = createRoot(() => {});
    root.render(<Button text="Click" onClick={() => {}} />);
    await waitForCommit();
    console.error = origError;

    const match = errors.some(e => e.message.includes('<Button> must be used inside <InlineKeyboard>'));
    expect(match).toBe(true);
  });

  test('ButtonRow outside InlineKeyboard throws', async () => {
    const errors: Error[] = [];
    const origError = console.error;
    console.error = (...args: any[]) => {
      if (args[0] instanceof Error) errors.push(args[0]);
      else if (typeof args[0] === 'string' && args.length > 1 && args[1] instanceof Error) errors.push(args[1]);
    };

    const root = createRoot(() => {});
    root.render(<ButtonRow><Button text="X" /></ButtonRow>);
    await waitForCommit();
    console.error = origError;

    const match = errors.some(e => e.message.includes('<ButtonRow> must be used inside <InlineKeyboard>'));
    expect(match).toBe(true);
  });

  test('Button inside InlineKeyboard works', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(
      <Message text="Test">
        <InlineKeyboard>
          <ButtonRow>
            <Button text="OK" onClick={() => {}} />
          </ButtonRow>
        </InlineKeyboard>
      </Message>
    );
    await waitForCommit();

    expect(output).not.toBeNull();
    expect(output!.type).toBe('tg-message');
    const kb = output!.children[0];
    expect(kb.type).toBe('tg-keyboard');
    const row = kb.children[0];
    expect(row.type).toBe('tg-button-row');
    const btn = row.children[0];
    expect(btn.type).toBe('tg-button');
    expect(btn.props.text).toBe('OK');
  });

  test('InlineKeyboard.Row alias works', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(
      <Message text="Alias test">
        <InlineKeyboard>
          <InlineKeyboard.Row>
            <Button text="Works" onClick={() => {}} />
          </InlineKeyboard.Row>
        </InlineKeyboard>
      </Message>
    );
    await waitForCommit();

    const row = output!.children[0].children[0];
    expect(row.type).toBe('tg-button-row');
    expect(row.children[0].props.text).toBe('Works');
  });

  test('Unknown host element type throws in reconciler', async () => {
    const errors: Error[] = [];
    const origError = console.error;
    console.error = (...args: any[]) => {
      if (args[0] instanceof Error) errors.push(args[0]);
      else if (typeof args[0] === 'string' && args.length > 1 && args[1] instanceof Error) errors.push(args[1]);
    };

    const root = createRoot(() => {});
    root.render(React.createElement('tg-unknown', { text: 'bad' }));
    await waitForCommit();
    console.error = origError;

    const match = errors.some(e => e.message.includes('Unknown Teact element <tg-unknown>'));
    expect(match).toBe(true);
  });
});

describe('Button variants', () => {
  test('default variant has no prefix', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(
      <Message text="v"><InlineKeyboard><ButtonRow>
        <Button text="Click" onClick={() => {}} />
      </ButtonRow></InlineKeyboard></Message>
    );
    await waitForCommit();
    const btn = output!.children[0].children[0].children[0];
    expect(btn.props.text).toBe('Click');
  });

  test('primary variant adds prefix', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(
      <Message text="v"><InlineKeyboard><ButtonRow>
        <Button text="Click" variant="primary" onClick={() => {}} />
      </ButtonRow></InlineKeyboard></Message>
    );
    await waitForCommit();
    const btn = output!.children[0].children[0].children[0];
    expect(btn.props.text).toBe('▸ Click');
  });

  test('destructive variant adds prefix', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(
      <Message text="v"><InlineKeyboard><ButtonRow>
        <Button text="Delete" variant="destructive" onClick={() => {}} />
      </ButtonRow></InlineKeyboard></Message>
    );
    await waitForCommit();
    const btn = output!.children[0].children[0].children[0];
    expect(btn.props.text).toBe('✕ Delete');
  });
});

describe('Message component', () => {
  test('renders with text', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(<Message text="Hello" />);
    await waitForCommit();
    expect(output!.type).toBe('tg-message');
    expect(output!.props.text).toBe('Hello');
  });

  test('renders with parseMode', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(<Message text="*bold*" parseMode="Markdown" />);
    await waitForCommit();
    expect(output!.props.parseMode).toBe('Markdown');
  });
});

describe('Media components', () => {
  test('Photo renders', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(<Photo src="https://example.com/pic.jpg" caption="Nice" />);
    await waitForCommit();
    expect(output!.type).toBe('tg-photo');
    expect(output!.props.src).toBe('https://example.com/pic.jpg');
    expect(output!.props.caption).toBe('Nice');
  });

  test('Document renders', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(<Document src="file.pdf" caption="Doc" filename="file.pdf" />);
    await waitForCommit();
    expect(output!.type).toBe('tg-document');
    expect(output!.props.filename).toBe('file.pdf');
  });
});

describe('Formatting components', () => {
  test('Bold renders', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(<Bold>important</Bold>);
    await waitForCommit();
    expect(output!.type).toBe('tg-bold');
  });

  test('Italic renders', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(<Italic>emphasized</Italic>);
    await waitForCommit();
    expect(output!.type).toBe('tg-italic');
  });

  test('Code renders with language', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(<Code language="typescript">const x = 1;</Code>);
    await waitForCommit();
    expect(output!.type).toBe('tg-code');
    expect(output!.props.language).toBe('typescript');
  });
});

describe('New utility components', () => {
  test('Alert renders with variant', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(<Alert variant="warning" title="Watch out">Be careful</Alert>);
    await waitForCommit();
    expect(output!.type).toBe('tg-alert');
    expect(output!.props.variant).toBe('warning');
    expect(output!.props.heading).toBe('⚠️ Watch out');
  });

  test('Alert defaults to info variant', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(<Alert>Info message</Alert>);
    await waitForCommit();
    expect(output!.props.heading).toBe('ℹ️');
  });

  test('List renders unordered', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(<List><ListItem>A</ListItem><ListItem>B</ListItem></List>);
    await waitForCommit();
    expect(output!.type).toBe('tg-list');
    expect(output!.props.ordered).toBe(false);
    expect(output!.children).toHaveLength(2);
  });

  test('List renders ordered', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(<List ordered><ListItem>First</ListItem></List>);
    await waitForCommit();
    expect(output!.props.ordered).toBe(true);
  });

  test('Divider renders', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(<Divider />);
    await waitForCommit();
    expect(output!.type).toBe('tg-divider');
    expect(output!.props.text).toBe('────────────────────');
  });

  test('Divider custom char', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(<Divider char="=" length={10} />);
    await waitForCommit();
    expect(output!.props.text).toBe('==========');
  });

  test('SuspenseFallback renders', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(<SuspenseFallback />);
    await waitForCommit();
    expect(output!.type).toBe('tg-message');
    expect(output!.props.text).toBe('⏳ Loading...');
  });
});
