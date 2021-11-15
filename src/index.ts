import * as fs from 'fs';
import * as path from 'path';
import {program} from 'commander';
import * as acorn from 'acorn';
import {Identifier, Node, SourceLocation} from 'estree';
import * as estraverse from 'estraverse';

async function listFiles(
  paths: string[],
  recursive: boolean
): Promise<string[]> {
  const results = await Promise.all(
    paths
      .map(name => path.resolve('', name))
      .map(name => listFilesRecursive(name, recursive, 0))
  );

  return [...new Set(results.flat())]
    .filter(name => name.endsWith('.js'))
    .sort();
}

async function listFilesRecursive(
  _path: string,
  recursive: boolean,
  depth: number
): Promise<string[]> {
  if (!recursive && depth > 1) {
    return [];
  }

  const stat = await fs.promises.lstat(_path);

  if (stat.isDirectory()) {
    const dirs = (await fs.promises.readdir(_path))
      .filter(name => !name.startsWith('.'))
      .map(name => path.resolve(_path, name));

    const results = await Promise.all(
      dirs.map(sub => listFilesRecursive(sub, recursive, depth + 1))
    );
    return results.flat();
  }

  if (stat.isFile()) {
    return [_path];
  }

  return [];
}

async function findSharedArrayBufferUsage(filename: string): Promise<boolean> {
  const buf = await fs.promises.readFile(filename);
  const program = acorn.parse(buf.toString(), {
    ecmaVersion: 'latest',
    locations: true,
  }) as Node;

  const result: Identifier[] = [];

  estraverse.traverse(program, {
    enter: (node: Node): void => {
      if (node.type === 'Identifier' && node.name === 'SharedArrayBuffer') {
        result.push(node);
      }
    },
  });

  showResult(filename, result);

  return result.length > 0;
}

function stringifySourceLocation(
  pos: SourceLocation | null | undefined
): string | undefined {
  if (
    pos === undefined ||
    pos === null ||
    pos.start === undefined ||
    pos.end === undefined
  ) {
    return undefined;
  }

  return pos.start.line === pos.end.line
    ? `${pos.start.line}:${pos.start.column}-${pos.end.column}`
    : `${pos.start.line}:${pos.start.column}-${pos.end.line}:${pos.end.column}`;
}

function showResult(filename: string, result: Identifier[]): void {
  if (result.length === 0) {
    console.log(`${filename} is SharedArrayBuffer-free.`);
    return;
  }

  console.log(`${filename} uses SharedArrayBuffer (${result.length} times):`);

  result.forEach((identifier, index) => {
    const location = stringifySourceLocation(identifier.loc);
    if (location !== undefined) {
      console.log(`  [${index + 1}] ${location}`);
    }
  });
}

interface CLIOptions {
  paths: string[];
  recursive: boolean;
  ext: string;
}

async function main(): Promise<number> {
  program
    .showHelpAfterError()
    .description('Detects usage of SharedArrayBuffer.')
    .option('-r, --recursive', 'recursively list JavaScript files')
    .argument('<paths...>');
  program.parse();

  const options = program.opts<CLIOptions>();
  const paths = program.processedArgs[0] as string[];

  const filenames = await listFiles(paths, options.recursive);
  const results = await Promise.all(
    filenames.map(filename => findSharedArrayBufferUsage(filename))
  );

  return results.filter(p => p).length;
}

main()
  .then(result => {
    if (result === 0) {
      console.log('No files use SharedArrayBuffer.');
    } else {
      console.log(`${result} files use SharedArrayBuffer.`);
      process.exitCode = 1;
    }
  })
  .catch(e => {
    console.error(e);
    process.exitCode = 1;
  });
