#!/usr/bin/env bun

const args = process.argv.slice(2);

// Fast path: `teact --version` doesn't even need the argument parser.
if (args.length === 1 && (args[0] === '--version' || args[0] === '-v' || args[0] === '-V')) {
  const { default: pkg } = await import('../package.json');
  console.log(pkg.version);
} else {
  const { program } = await import('./cli');
  await program.parseAsync(process.argv).catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}

export {};
