import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { heading, success, error, findProjectRoot } from '../utils';

const GENERATORS: Record<string, (name: string, projectRoot: string) => void> = {
  component: generateComponent,
  hook: generateHook,
  plugin: generatePlugin,
};

export async function generateCommand(type: string, name: string): Promise<void> {
  const generator = GENERATORS[type];
  if (!generator) {
    error(`Unknown generator: ${type}. Available: ${Object.keys(GENERATORS).join(', ')}`);
    process.exit(1);
  }

  const projectRoot = findProjectRoot() || process.cwd();
  heading(`Generating ${type}: ${name}`);
  generator(name, projectRoot);
}

function generateComponent(name: string, root: string): void {
  const dir = join(root, 'src', 'components');
  mkdirSync(dir, { recursive: true });

  const filePath = join(dir, `${name}.tsx`);
  if (existsSync(filePath)) {
    error(`File already exists: ${filePath}`);
    return;
  }

  writeFileSync(
    filePath,
    `import { useNavigate } from '@teact/core';
import { Message, Button, InlineKeyboard, ButtonRow } from '@teact/ui';

export function ${name}() {
  const navigate = useNavigate();

  return (
    <Message text="${name}">
      <InlineKeyboard>
        <ButtonRow>
          <Button text="Back" onClick={() => navigate('/')} />
        </ButtonRow>
      </InlineKeyboard>
    </Message>
  );
}
`
  );

  success(`Created src/components/${name}.tsx`);
}

function generateHook(name: string, root: string): void {
  const dir = join(root, 'src', 'hooks');
  mkdirSync(dir, { recursive: true });

  const hookName = name.startsWith('use') ? name : `use${name.charAt(0).toUpperCase() + name.slice(1)}`;
  const filePath = join(dir, `${hookName}.ts`);

  if (existsSync(filePath)) {
    error(`File already exists: ${filePath}`);
    return;
  }

  writeFileSync(
    filePath,
    `import { useState, useCallback } from '@teact/core';

export function ${hookName}() {
  const [state, setState] = useState(null);
  return { state, setState };
}
`
  );

  success(`Created src/hooks/${hookName}.ts`);
}

function generatePlugin(name: string, root: string): void {
  const dir = join(root, 'src', 'plugins');
  mkdirSync(dir, { recursive: true });

  const filePath = join(dir, `${name}.ts`);
  if (existsSync(filePath)) {
    error(`File already exists: ${filePath}`);
    return;
  }

  writeFileSync(
    filePath,
    `import type { TeactPlugin } from '@teact/core';

export function ${name}Plugin(): TeactPlugin {
  return {
    name: '${name}',
    onStart(adapter) {
      console.log('[${name}] Plugin started');
    },
    onStop() {
      console.log('[${name}] Plugin stopped');
    },
  };
}
`
  );

  success(`Created src/plugins/${name}.ts`);
}
