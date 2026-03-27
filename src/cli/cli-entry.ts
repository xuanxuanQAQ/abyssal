/**
 * CLI entry point — command-line argument parsing and batch dispatch.
 *
 * Invoked from main.ts when --batch flag is detected.
 * Parses stage, paper/concept filters, concurrency, dry-run mode.
 *
 * See spec: section 8.1
 */

// ─── Types ───

export interface CliArgs {
  stage: 'all' | 'discover' | 'acquire' | 'analyze' | 'synthesize' | 'article' | 'bibliography';
  paperIds: string[];
  filter: Record<string, unknown> | null;
  conceptIds: string[];
  workspace: string;
  configPath: string | null;
  concurrency: number;
  dryRun: boolean;
  verbose: boolean;
  articleId: string | null;
}

// ─── Argument parsing ───

export function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    stage: 'all',
    paperIds: [],
    filter: null,
    conceptIds: [],
    workspace: '',
    configPath: null,
    concurrency: 3,
    dryRun: false,
    verbose: false,
    articleId: null,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = argv[i + 1];

    if (arg === '--stage' && next) {
      args.stage = next as CliArgs['stage'];
      i++;
    } else if (arg === '--papers' && next) {
      args.paperIds = next.split(',').map((s) => s.trim()).filter(Boolean);
      i++;
    } else if (arg === '--filter' && next) {
      try { args.filter = JSON.parse(next); } catch { /* ignore */ }
      i++;
    } else if (arg === '--concepts' && next) {
      args.conceptIds = next.split(',').map((s) => s.trim()).filter(Boolean);
      i++;
    } else if ((arg === '--workspace' || arg === '-w') && next) {
      args.workspace = next;
      i++;
    } else if (arg === '--config' && next) {
      args.configPath = next;
      i++;
    } else if (arg === '--concurrency' && next) {
      args.concurrency = parseInt(next, 10) || 3;
      i++;
    } else if (arg === '--article' && next) {
      args.articleId = next;
      i++;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--verbose') {
      args.verbose = true;
    }
    // Skip unknown args (Electron internal args, --batch itself, etc.)
  }

  return args;
}
